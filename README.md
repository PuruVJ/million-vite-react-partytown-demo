Starting, the assumption is that the we are including google tag manager to both index.html as well as in one of the react components, using `<script __dangerousSetInnerHtml={{}}>` approach.

My solution is to add automatic PartyTown functionality based on whether we detect google analytics anywhere in those. This will be done using a custom Vite plugin, where we parse the index html and react components for the presence of google analytics script tags. If found, we modify the code and add the required code

For index.html, simply adding `type="text/partytown"` to the script tag is enough. For react components, we need to import the `<Partytown />` component and add it to the component tree, passing it `window.datalayer` and keeping debug on during development.

For parsing JSX, I will be using Babel for its ease of use. For higher performance, we can look into using SWC instead.
