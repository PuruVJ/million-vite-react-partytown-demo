Starting, the assumption is that the we are including google tag manager to both index.html as well as in one of the react components, using `<script __dangerousSetInnerHtml={{}}>` approach.

My solution is to add automatic PartyTown functionality based on whether we detect google analytics anywhere in those. This will be done using a custom Vite plugin, where we parse the index html and react components for the presence of google analytics script tags. If found, we modify the code and add the required code

For index.html, simply adding `type="text/partytown"` to the script tag is enough. For react components, we need to import the `<Partytown />` component and add it to the component tree, passing it `window.datalayer` and keeping debug on during development. This currently doesn't account for `src=""`, referring to the GTM script hidden somewhere, but can be added by analyzing all the files going through Vite.

For parsing JSX, I will be using Babel for its ease of use. For higher performance, we can look into using SWC instead, although visitor plugins for that require to be written in Rust.

Adding support for Facebook Pixel, and other common services supported by Partytown, can be done by adding more checks in the plugin. Caveat is that it requires extensive static analysis, which can blow up the code quite a bit. Other simpler option would be to check the `window` for certain properties and assume that the script is present, but that is a runtime solution.
