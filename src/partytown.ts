import { parse } from '@babel/parser';
import * as t from '@babel/types';
import { partytownSnippet } from '@builder.io/partytown/integration';
import { copyLibFiles } from '@builder.io/partytown/utils';
import { Plugin } from 'vite';

// This hack required because these packages are CJS, so default.default has to be used
const traverse = // @ts-ignore
	(await import('@babel/traverse')).default.default as typeof import('@babel/traverse').default;

const generate = // @ts-ignore
	(await import('@babel/generator')).default.default as typeof import('@babel/generator').default;

export function dynamic_party(): Plugin {
	let should_inject_partytown = false;
	let public_path = '';
	let development = true;

	let includes_gtm = false;
	// TODO: Add support for Facebook Pixel
	// let includes_fbq = false

	const { promise, resolve } = with_resolvers();

	return {
		name: 'dynamic-partytown',
		enforce: 'pre',
		configResolved(config) {
			public_path = config.publicDir;
			development = config.env.DEV;
		},
		transform(code, id) {
			// Filter out non-JSX/TSX files
			if (!/\.[jt]sx$/.test(id)) return;

			// Step 1: Parse the code to AST
			const ast = parse(code, {
				sourceType: 'module',
				plugins: ['typescript', 'jsx'],
			});

			let modified = false;

			let found_datalayer = false;

			// Step 2: Traverse the AST to find the datalayer
			traverse(ast, {
				JSXElement(path) {
					// Looking for a JSX element
					const node_name = path.node.openingElement.name;

					if (t.isJSXIdentifier(node_name) && node_name.name === 'script') {
						/** We found a script, now determine whether this uses Google Tag manager */
						const attributes = path.node.openingElement.attributes;

						// Find the value of dangerouslySetInnerHTML
						const inner_html = attributes.find((attr) => {
							return (
								t.isJSXAttribute(attr) &&
								t.isJSXIdentifier(attr.name) &&
								attr.name.name === 'dangerouslySetInnerHTML'
							);
						}) as t.JSXAttribute;

						if (!inner_html) {
							// Nothing to do here
							return;
						}

						// Find the value of __html
						// TODO: Refactor to actually be readable
						const __html_value = (
							(
								(inner_html.value as t.JSXExpressionContainer).expression as t.ObjectExpression
							).properties.find(
								(prop) =>
									t.isObjectProperty(prop) && t.isIdentifier(prop.key) && prop.key.name === '__html'
							) as t.ObjectProperty
						).value as t.StringLiteral | t.TemplateLiteral;

						if (!__html_value) return;

						// We need to access value for StringLiteral and quasis[0].value.raw for TemplateLiteral
						let final_value = '';
						if (t.isStringLiteral(__html_value)) {
							final_value = __html_value.value;
						} else if (t.isTemplateLiteral(__html_value)) {
							final_value = __html_value.quasis[0].value.raw;
						}

						includes_gtm = found_datalayer = has_gtm(final_value);

						if (!found_datalayer) return console.log('Google tag manager not found');

						// idx of the type="text/something" attrivute, if there is one
						const idx = path.node.openingElement.attributes.findIndex(
							(attr) =>
								t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'type'
						);

						// Step 3: Modify the AST
						// Remove the type attribute
						if (idx !== -1) path.node.openingElement.attributes.splice(idx, 1);

						// Add type=text/partytown
						path.node.openingElement.attributes.push(
							t.jsxAttribute(t.jsxIdentifier('type'), t.stringLiteral('text/partytown'))
						);

						modified = true;
					}
				},
			});

			if (!modified) return { code };

			// Now that we know datalayer is present, let's inject partytown stuff. It's better to inject in index.html
			// because we don't have to worry about the order of scripts.
			// This will be done in `transformIndexHtml` hook
			should_inject_partytown = true;
			resolve(null);

			// Step 4: Generate the modified code
			const output = generate(ast, {}, code);

			return {
				code: output.code,
				map: output.map,
			};
		},
		async transformIndexHtml(html) {
			// Look for script tags in this
			const script_tags = find_inline_script_tags(html);

			for (const { content, full } of script_tags) {
				if (has_gtm(content)) {
					should_inject_partytown = true;

					const new_script_tag = full.replace(/<script\b[^>]*>/, '<script type="text/partytown">');
					html = html.replace(full, new_script_tag);

					break;
				}
			}

			await promise;

			// Leave it alone
			if (!should_inject_partytown) return html;

			// Copy partytown files to public
			await copyLibFiles(public_path + '/~partytown');

			return {
				html,
				tags: [
					// Partytown scripts
					{
						injectTo: 'head',
						tag: 'script',
						children: partytownSnippet(),
					},

					// The partytown config
					{
						injectTo: 'head-prepend',
						tag: 'script',
						children: `partytown = {
							debug: ${development},
							forward: ${JSON.stringify([includes_gtm && 'dataLayer.push'].filter(Boolean))}
						};`,
					},
				],
			};
		},
	};
}

function find_inline_script_tags(html: string) {
	const regex = /<script\b[^>]*>([\s\S]*?)<\/script>/gm;
	let matches = [];
	let match;

	while ((match = regex.exec(html)) !== null) {
		// This is necessary to avoid infinite loops with zero-width matches
		if (match.index === regex.lastIndex) {
			regex.lastIndex++;
		}

		// The first group in the match contains the script content
		if (match[1].trim() !== '') {
			matches.push({ full: match[0], content: match[1] });
		}
	}

	return matches;
}

function has_gtm(value: string) {
	let found_datalayer = false;

	// Now parse this with babel and find out whether it got datalayer IIFe or window.datalayer = ...
	const script_ast = parse(value, {
		sourceType: 'module',
	});

	// Function to check if a node is an IIFE
	const is_iife = (node: t.Node) => {
		return node.type === 'CallExpression' && node.callee.type === 'FunctionExpression';
	};

	traverse(script_ast, {
		MemberExpression(path) {
			if (
				path.get('object').matchesPattern('window') &&
				path.get('property').isIdentifier({ name: 'dataLayer' })
			) {
				found_datalayer = true;
			}
		},

		CallExpression(path) {
			if (is_iife(path.node)) {
				// Check each argument of the IIFE
				path.node.arguments.forEach((arg) => {
					if (
						(t.isStringLiteral(arg) && arg.value === 'dataLayer') ||
						(t.isTemplateLiteral(arg) && arg.quasis[0].value.raw === 'dataLayer')
					) {
						found_datalayer = true;
					}
				});
			}
		},
	});

	return found_datalayer;
}

/**
 *
 * @param timeout HACK!!! Make sure its not freezing index.html in any way. TODO: Figure out a way to know if Vite's transforms are done!
 * @returns
 */
function with_resolvers<T>(timeout = 2000) {
	let resolve: (value: T | PromiseLike<T>) => void = () => null;
	let reject: (reason?: unknown) => void = () => null;

	const promise = new Promise<T>((_resolve, _reject) => {
		resolve = _resolve;
		reject = _reject;

		setTimeout(() => {
			resolve(null as T);
		}, timeout);
	});

	return { resolve, reject, promise };
}
