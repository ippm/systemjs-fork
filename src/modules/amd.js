/*
	SystemJS AMD Format
*/
// AMD Module Format Detection RegEx
// define([.., .., ..], ...)
// define(varName); || define(function(require, exports) {}); || define({})

import {
	__global,
	exec as __exec,
	isBrowser,
	createEntry,
} from '../utils';

/* eslint-disable no-param-reassign */

const amdRegEx = /(?:^\uFEFF?|[^$_a-zA-Z\xA0-\uFFFF.])define\s*\(\s*("[^"]+"\s*,\s*|'[^']+'\s*,\s*)?\s*(\[(\s*(("[^"]+"|'[^']+')\s*,|\/\/.*\r?\n|\/\*(.|\s)*?\*\/))*(\s*("[^"]+"|'[^']+')\s*,?)?(\s*(\/\/.*\r?\n|\/\*(.|\s)*?\*\/))*\s*\]|function\s*|{|[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*\))/;

function instantiate(next) {
	return function $instantiate(load) {
		if (load.metadata.format === 'amd' || !load.metadata.format && load.source.match(amdRegEx)) {
			load.metadata.format = 'amd';

			if (!this.builder && this.execute !== false) {
				const curDefine = __global.define;
				__global.define = this.amdDefine;

				try {
					__exec.call(this, load);
				} finally {
					__global.define = curDefine;
				}

				if (!load.metadata.entry && !load.metadata.bundle) {
					throw new TypeError(`AMD module ${load.name} did not define`);
				}
			} else {
				load.metadata.execute = function $execute(...args) {
					return this::load.metadata.builderExecute(...args);
				};
			}
		}

		return next.call(this, load);
	};
}


/* eslint-disable no-param-reassign */
function fetch(next) {
	return function $fetch(load) {
		// script load implies define global leak
		if (load.metadata.scriptLoad && isBrowser) __global.define = this.amdDefine;
		return next.call(this, load);
	};
}

const commentRegEx = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg;
const cjsRequirePre = '(?:^|[^$_a-zA-Z\\xA0-\\uFFFF.])';
const cjsRequirePost = "\\s*\\(\\s*(\"([^\"]+)\"|'([^']+)')\\s*\\)";
const fnBracketRegEx = /\(([^\)]*)\)/;
const wsRegEx = /^\s+|\s+$/g;

function constructor(next) {
	return function $constructor() {
		const loader = this;
		next.call(this);

		const requireRegExs = {};

		function getCJSDeps(source, requireIndex) {
			// remove comments
			source = source.replace(commentRegEx, '');

			// determine the require alias
			const params = source.match(fnBracketRegEx);
			const requireAlias = (params[1].split(',')[requireIndex] || 'require').replace(wsRegEx, '');

			// find or generate the regex for this requireAlias
			let requireRegEx = requireRegExs[requireAlias];
			if (requireRegEx === undefined) {
				requireRegEx = new RegExp(cjsRequirePre + requireAlias + cjsRequirePost, 'g');
				requireRegExs[requireAlias] = requireRegEx;
			}

			requireRegEx.lastIndex = 0;

			const deps = [];

			for (;;) {
				const match = requireRegEx.exec(source);
				if (!match) break;
				deps.push(match[2] || match[3]);
			}

			return deps;
		}

		/*
			AMD-compatible require
			To copy RequireJS, set window.require = window.requirejs = loader.amdRequire
		*/
		function require(names, callback, errback, referer) {
			// in amd, first arg can be a config object... we just ignore
			if (typeof names === 'object' && !Array.isArray(names)) {
				return require(callback, errback, referer);
			}

			// amd require
			if (typeof names === 'string' && typeof callback === 'function') names = [names];
			if (Array.isArray(names)) {
				const dynamicRequires = [];
				for (let i = 0; i < names.length; i++) {
					dynamicRequires.push(loader.import(names[i], referer));
				}
				Promise.all(dynamicRequires).then(
					modules => {
						if (callback) callback.apply(null, modules);
					},
					errback
				);
			} else if (typeof names === 'string') {
				// commonjs require
				const defaultJSExtension =
					loader.defaultJSExtensions && names.substr(names.length - 3, 3) !== '.js';
				let normalized = loader.decanonicalize(names, referer);
				if (defaultJSExtension && normalized.substr(normalized.length - 3, 3) === '.js') {
					normalized = normalized.substr(0, normalized.length - 3);
				}
				const module = loader.get(normalized);
				if (!module) {
					throw new Error(
						// eslint-disable-next-line prefer-template
						`Module not already loaded loading "${names}" as ${normalized}` +
						(referer ? ` from "${referer}".` : '.')
					);
				}
				return module.__useDefault ? module.default : module;
			} else throw new TypeError('Invalid require');
			return undefined;
		}

		function define(name, deps, factory) {
			if (typeof name !== 'string') {
				factory = deps;
				deps = name;
				name = null;
			}
			if (!Array.isArray(deps)) {
				factory = deps;
				deps = ['require', 'exports', 'module'].splice(0, factory.length);
			}

			if (typeof factory !== 'function') {
				factory = (() => () => factory)(factory);
			}

			// in IE8, a trailing comma becomes a trailing undefined entry
			if (deps[deps.length - 1] === undefined) deps.pop();

			// remove system dependencies
			const requireIndex = deps.indexOf('require');
			if (requireIndex !== -1) {
				deps.splice(requireIndex, 1);

				// only trace cjs requires for non-named
				// named defines assume the trace has already been done
				if (!name) deps = deps.concat(getCJSDeps(factory.toString(), requireIndex));
			}

			const exportsIndex = deps.indexOf('exports');
			if (exportsIndex !== -1) deps.splice(exportsIndex, 1);

			const moduleIndex = deps.indexOf('module');
			if (moduleIndex !== -1) deps.splice(moduleIndex, 1);

			function execute(req, exports, module) {
				const depValues = [];
				for (let i = 0; i < deps.length; i++) depValues.push(req(deps[i]));

				module.uri = module.id;

				module.config = () => {};

				// add back in system dependencies
				if (moduleIndex !== -1) depValues.splice(moduleIndex, 0, module);

				if (exportsIndex !== -1) depValues.splice(exportsIndex, 0, exports);

				if (requireIndex !== -1) {
					const contextualRequire = (names, callback, errback) => {
						if (typeof names === 'string' && typeof callback !== 'function') return req(names);
						return require.call(loader, names, callback, errback, module.id);
					};

					// eslint-disable-next-line no-shadow
					contextualRequire.toUrl = name => {
						// normalize without defaultJSExtensions
						const defaultJSExtension =
							loader.defaultJSExtensions && name.substr(name.length - 3, 3) !== '.js';
						let url = loader.decanonicalize(name, module.id);
						if (defaultJSExtension && url.substr(url.length - 3, 3) === '.js') {
							url = url.substr(0, url.length - 3);
						}
						return url;
					};
					depValues.splice(requireIndex, 0, contextualRequire);
				}

				// set global require to AMD require
				const curRequire = __global.require;
				__global.require = require;

				let output = factory.apply(exportsIndex === -1 ? __global : exports, depValues);

				__global.require = curRequire;

				if (typeof output === 'undefined' && module) output = module.exports;
				if (typeof output !== 'undefined') return output;
				return undefined;
			}

			const entry = createEntry();
			entry.name = name && (loader.decanonicalize || loader.normalize).call(loader, name);
			entry.deps = deps;
			entry.execute = execute;

			loader.pushRegister_({
				amd: true,
				entry,
			});
		}
		define.amd = {};

		loader.amdDefine = define;
		loader.amdRequire = require;
	};
}

// reduction function to attach defines to a load record
function reduceRegister_(next) {
	return function $reduceRegister_(load, register) {
		// only handle AMD registers here
		if (!register || !register.amd) return next.call(this, load, register);

		const curMeta = load && load.metadata;
		const entry = register.entry;

		if (curMeta) {
			if (!curMeta.format || curMeta.format === 'detect') curMeta.format = 'amd';
			else if (!entry.name && curMeta.format !== 'amd') {
				throw new Error(
					`AMD define called while executing ${curMeta.format} module ${load.name}`
				);
			}
		}

		// anonymous define
		if (!entry.name) {
			if (!curMeta) throw new TypeError('Unexpected anonymous AMD define.');

			if (curMeta.entry && !curMeta.entry.name) {
				throw new Error(`Multiple anonymous defines in module ${load.name}`);
			}
			curMeta.entry = entry;
		} else {
			// named define
			// if we don't have any other defines,
			// then let this be an anonymous define
			// this is just to support single modules of the form:
			// define('jquery')
			// still loading anonymously
			// because it is done widely enough to be useful
			// as soon as there is more than one define, this gets removed though
			if (curMeta) {
				if (!curMeta.entry && !curMeta.bundle) curMeta.entry = entry;
				else if (curMeta.entry && curMeta.entry.name) curMeta.entry = undefined;

				// note this is now a bundle
				curMeta.bundle = true;
			}

			// define the module through the register registry
			if (!(entry.name in this.defined)) this.defined[entry.name] = entry;
		}
	};
}

export default {
	instantiate,
	fetch,
	constructor,
	reduceRegister_,
};
