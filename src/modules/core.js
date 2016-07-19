import {
	isBrowser,
	baseURI,
	baseURIObj,
	isPlain,
	isRel,
	isAbsolute,
	urlResolve,
	getESModule,
	applyPaths,
	warn,
	createEntry,
	setPkgConfig,
} from '../utils';
import fetchTextFromURL from '../system-fetch';
import URL from '../url';

/* eslint-disable no-param-reassign */

function getMapMatch(map, name) {
	let bestMatch = 0;
	let bestMatchLength = 0;

	for (const p in map) {
		if (name.substr(0, p.length) === p && (name.length === p.length || name[p.length] === '/')) {
			const curMatchLength = p.split('/').length;
			if (curMatchLength <= bestMatchLength) continue;
			bestMatch = p;
			bestMatchLength = curMatchLength;
		}
	}

	return bestMatch;
}

function prepareBaseURL() {
	// ensure baseURl is fully normalized
	if (this._loader.baseURL !== this.baseURL) {
		if (this.baseURL[this.baseURL.length - 1] !== '/') this.baseURL += '/';
		this._loader.baseURL = this.baseURL = new URL(this.baseURL, baseURIObj).href;
	}
}

let envModule;
function setProduction(isProduction, isBuilder) {
	this.set('@system-env', envModule = this.newModule({
		browser: isBrowser,
		node: !!this._nodeRequire,
		production: !isBuilder && isProduction,
		dev: isBuilder || !isProduction,
		build: isBuilder,
		default: true,
	}));
}

function constructor(next) {
	return function $constructor() {
		next.call(this);

		// support baseURL
		this.baseURL = baseURI;

		// support map and paths
		this.map = {};

		// global behaviour flags
		this.warnings = false;
		this.defaultJSExtensions = false;
		this.pluginFirst = false;
		this.loaderErrorStack = false;

		// by default load ".json" files as json
		// leading * meta doesn't need normalization
		// NB add this in next breaking release
		// this.meta['*.json'] = { format: 'json' };

		// support the empty module, as a concept
		this.set('@empty', this.newModule({}));

		setProduction.call(this, false, false);
	};
}

// include the node require since we're overriding it
function _nodeRequire() {
	if (typeof require !== 'undefined' && typeof process !== 'undefined' && !process.browser) {
		return require;
	}
	return undefined;
}

/*
	Core SystemJS Normalization

	If a name is relative, we apply URL normalization to the page
	If a name is an absolute URL, we leave it as-is

	Plain names (neither of the above) run through the map and paths
	normalization phases.

	The paths normalization phase applies last (paths extension), which
	defines the `decanonicalize` function and normalizes everything into
	a URL.
 */

function getNodeModule(name) {
	if (!isPlain(name)) {
		throw new Error(`Node module ${name} can't be loaded as it is not a package require.`);
	}

	const nodePath = this._nodeRequire('path');
	// try to load from node_modules
	let module;
	try {
		module = this._nodeRequire(nodePath.resolve(process.cwd(), 'node_modules', name));
	} catch (e) {
		// fall back to direct require (in theory this is core modules only,
		// which should really be filtered)
		if (e.code === 'MODULE_NOT_FOUND') module = this._nodeRequire(name);
	}
	return module;
}

export function coreResolve(name, parentName) {
	// standard URL resolution
	if (isRel(name)) return urlResolve(name, parentName);
	else if (isAbsolute(name)) return name;

	// plain names not starting with './', '://' and '/' go through custom resolution
	const mapMatch = getMapMatch(this.map, name);

	if (mapMatch) {
		name = this.map[mapMatch] + name.substr(mapMatch.length);

		if (isRel(name)) return urlResolve(name);
		else if (isAbsolute(name)) return name;
	}

	if (this.has(name)) return name;
	// dynamically load node-core modules when requiring `@node/fs` for example
	if (name.substr(0, 6) === '@node/') {
		if (!this._nodeRequire) {
			throw new TypeError(`Error loading ${name}. Can only load node core modules in Node.`);
		}
		this.set(name, this.newModule(getESModule(getNodeModule.call(this, name.substr(6)))));
		return name;
	}

	// prepare the baseURL to ensure it is normalized
	prepareBaseURL.call(this);

	return applyPaths(this, name) || this.baseURL + name;
}

function normalize() {
	return function $normalize(name, parentName, skipExt) {
		let resolved = coreResolve.call(this, name, parentName);
		if (
			this.defaultJSExtensions &&
			!skipExt &&
			resolved.substr(resolved.length - 3, 3) !== '.js' &&
			!isPlain(resolved)
		) {
			resolved += '.js';
		}
		return resolved;
	};
}

// percent encode just '#' in urls if using HTTP requests
const httpRequest = typeof XMLHttpRequest !== 'undefined';
function locate(next) {
	return function $locate(load) {
		return Promise.resolve(next.call(this, load)).then(address => {
			if (httpRequest) return address.replace(/#/g, '%23');
			return address;
		});
	};
}

/*
 * Fetch with authorization
 */
function fetch() {
	return function $fetch(load) {
		return new Promise((resolve, reject) =>
			fetchTextFromURL(load.address, load.metadata.authorization, resolve, reject)
		);
	};
}

/*
	__useDefault

	When a module object looks like:
	newModule(
		__useDefault: true,
		default: 'some-module'
	})

	Then importing that module provides the 'some-module'
	result directly instead of the full module.

	Useful for eg module.exports = function() {}
*/

function _import(next) {
	return function $import(name, parentName, parentAddress) {
		if (parentName && parentName.name) {
			warn.call(
				this,
				`SystemJS.import(name, {name: parentName}) is deprecated for SystemJS.import(name, parentName), while importing ${name} from ${parentName.name}`
			);
		}
		return next.call(this, name, parentName, parentAddress).then(module =>
			module.__useDefault ? module.default : module
		);
	};
}

/*
 * Allow format: 'detect' meta to enable format detection
 */
function translate(next) {
	return function $translate(load, ...args) {
		if (load.metadata.format === 'detect') load.metadata.format = undefined;
		return this::next(load, ...args);
	};
}


/*
 * JSON format support
 *
 * Supports loading JSON files as a module format itself
 *
 * Usage:
 *
 * SystemJS.config({
 *	 meta: {
 *		 '*.json': { format: 'json' }
 *	 }
 * });
 *
 * Module is returned as if written:
 *
 * export default {JSON}
 *
 * No named exports are provided
 *
 * Files ending in ".json" are treated as json automatically by SystemJS
 */
function instantiate() {
	return function $instantiate(load) {
		if (load.metadata.format === 'json' && !this.builder) {
			const entry = load.metadata.entry = createEntry();
			entry.deps = [];
			entry.execute = () => {
				try {
					return JSON.parse(load.source);
				} catch (e) {
					throw new Error(`Invalid JSON file ${load.name}`);
				}
			};
		}
	};
}

/*
 Extend config merging one deep only

	loader.config({
		some: 'random',
		config: 'here',
		deep: {
			config: { too: 'too' }
		}
	});

	<=>

	loader.some = 'random';
	loader.config = 'here'
	loader.deep = loader.deep || {};
	loader.deep.config = { too: 'too' };


	Normalizes meta and package configs allowing for:

	SystemJS.config({
		meta: {
			'./index.js': {}
		}
	});

	To become

	SystemJS.meta['https://thissite.com/index.js'] = {};

	For easy normalization canonicalization with latest URL support.

*/
function envSet(loader, cfg, envCallback) {
	if (envModule.browser && cfg.browserConfig) envCallback(cfg.browserConfig);
	if (envModule.node && cfg.nodeConfig) envCallback(cfg.nodeConfig);
	if (envModule.dev && cfg.devConfig) envCallback(cfg.devConfig);
	if (envModule.build && cfg.buildConfig) envCallback(cfg.buildConfig);
	if (envModule.production && cfg.productionConfig) envCallback(cfg.productionConfig);
}

function getConfig() {
	return function $getConfig() {
		const cfg = {};
		for (const p in this) {
			if (!this.hasOwnProperty(p) || p in this.constructor.prototype) continue;
			if (
				['_loader', 'amdDefine', 'amdRequire',
				'defined', 'failed', 'version'].indexOf(p) === -1
			) {
				cfg[p] = this[p];
			}
		}
		cfg.production = envModule.production;
		return cfg;
	};
}

function checkHasConfig(obj) {
	for (const p in obj) {
		if (obj.hasOwnProperty(p)) return true;
	}
	return false;
}

let curCurScript;
function config() {
	return function $config(cfg, isEnvConfig) {
		if ('loaderErrorStack' in cfg) {
			curCurScript = $__curScript;
			if (cfg.loaderErrorStack) $__curScript = undefined;
			else $__curScript = curCurScript;
		}

		if ('warnings' in cfg) this.warnings = cfg.warnings;

		// transpiler deprecation path
		if (cfg.transpilerRuntime === false) this._loader.loadedTranspilerRuntime = true;

		if ('production' in cfg || 'build' in cfg) {
			setProduction.call(this, !!cfg.production, !!(cfg.build || envModule && envModule.build));
		}

		if (!isEnvConfig) {
			// if using nodeConfig / browserConfig / productionConfig, take baseURL from there
			// these exceptions will be unnecessary when we can properly implement config queuings
			let baseURL;
			envSet(this, cfg, c => {
				baseURL = baseURL || c.baseURL;
			});
			baseURL = baseURL || cfg.baseURL;

			// always configure baseURL first
			if (baseURL) {
				if (
					checkHasConfig(this.packages) ||
					checkHasConfig(this.meta) ||
					checkHasConfig(this.depCache) ||
					checkHasConfig(this.bundles) ||
					checkHasConfig(this.packageConfigPaths)
				) {
					throw new TypeError('Incorrect configuration order. The baseURL must be configured with the first SystemJS.config call.');
				}

				this.baseURL = baseURL;
				prepareBaseURL.call(this);
			}

			if (cfg.paths) Object.assign(this.paths, cfg.paths);

			envSet(this, cfg, c => {
				if (c.paths) Object.assign(this.paths, c.paths);
			});

			// warn on wildcard path deprecations
			if (this.warnings) {
				for (const p in this.paths) {
					if (p.indexOf('*') !== -1) {
						warn.call(this, `Paths configuration "${p}" -> "${this.paths[p]}" uses wildcards which are being deprecated for simpler trailing "/" folder paths.`);
					}
				}
			}
		}

		if (cfg.defaultJSExtensions) {
			this.defaultJSExtensions = cfg.defaultJSExtensions;
			warn.call(this, 'The defaultJSExtensions configuration option is deprecated, use packages configuration instead.');
		}

		if (cfg.pluginFirst) this.pluginFirst = cfg.pluginFirst;

		if (cfg.map) {
			let objMaps = '';
			for (const p in cfg.map) {
				const v = cfg.map[p];

				// object map backwards-compat into packages configuration
				if (typeof v !== 'string') {
					objMaps += `${objMaps.length ? ', ' : ''}"${p}"`;
					warn.call(this, `The map configuration for ${objMaps} uses object submaps, which is deprecated in global map.\nUpdate this to use package contextual map with configs like SystemJS.config({ packages: { "${p}": { map: {...} } } }).`);

					const defaultJSExtension =
						this.defaultJSExtensions &&
						p.substr(p.length - 3, 3) !== '.js';
					let prop = this.decanonicalize(p);
					if (defaultJSExtension && prop.substr(prop.length - 3, 3) === '.js') {
						prop = prop.substr(0, prop.length - 3);
					}

					// if a package main, revert it
					let pkgMatch = '';
					for (const pkg in this.packages) {
						if (
							prop.substr(0, pkg.length) === pkg
							&& (!prop[pkg.length] || prop[pkg.length] === '/')
							&& pkgMatch.split('/').length < pkg.split('/').length
						) {
							pkgMatch = pkg;
						}
					}
					if (pkgMatch && this.packages[pkgMatch].main) {
						prop = prop.substr(0, prop.length - this.packages[pkgMatch].main.length - 1);
					}

					const pkg = this.packages[prop] = this.packages[prop] || {};
					pkg.map = v;
				} else this.map[p] = v;
			}
		}

		if (cfg.packageConfigPaths) {
			const packageConfigPaths = [];
			for (let i = 0; i < cfg.packageConfigPaths.length; i++) {
				const path = cfg.packageConfigPaths[i];
				const packageLength = Math.max(path.lastIndexOf('*') + 1, path.lastIndexOf('/'));
				const normalized = coreResolve.call(this, path.substr(0, packageLength));
				packageConfigPaths[i] = normalized + path.substr(packageLength);
			}
			this.packageConfigPaths = packageConfigPaths;
		}

		if (cfg.bundles) {
			for (const p in cfg.bundles) {
				const bundle = [];
				for (let i = 0; i < cfg.bundles[p].length; i++) {
					const defaultJSExtension =
						this.defaultJSExtensions &&
						cfg.bundles[p][i].substr(cfg.bundles[p][i].length - 3, 3) !== '.js';
					let normalizedBundleDep = this.decanonicalize(cfg.bundles[p][i]);
					if (
						defaultJSExtension &&
						normalizedBundleDep.substr(normalizedBundleDep.length - 3, 3) === '.js'
					) {
						normalizedBundleDep = normalizedBundleDep.substr(0, normalizedBundleDep.length - 3);
					}
					bundle.push(normalizedBundleDep);
				}
				this.bundles[p] = bundle;
			}
		}

		if (cfg.packages) {
			for (const p in cfg.packages) {
				if (p.match(/^([^\/]+:)?\/\/$/)) throw new TypeError(`"${p}" is not a valid package name.`);

				let prop = coreResolve.call(this, p);

				// allow trailing slash in packages
				if (prop[prop.length - 1] === '/') prop = prop.substr(0, prop.length - 1);

				setPkgConfig(this, prop, cfg.packages[p], false);
			}
		}

		for (const c in cfg) {
			const v = cfg[c];

			if (
				['baseURL', 'map', 'packages', 'bundles', 'paths', 'warnings',
				'packageConfigPaths', 'loaderErrorStack', 'browserConfig', 'nodeConfig',
				'devConfig', 'buildConfig', 'productionConfig'].indexOf(c) !== -1
			) {
				continue;
			}

			if (typeof v !== 'object' || Array.isArray(v)) this[c] = v;
			else {
				this[c] = this[c] || {};

				for (const p in v) {
					// base-level wildcard meta does not normalize to retain catch-all quality
					if (c === 'meta' && p[0] === '*') {
						this[c][p] = this[c][p] || {};
						Object.assign(this[c][p], v[p]);
					} else if (c === 'meta') {
						// meta can go through global map, with defaultJSExtensions adding
						let resolved = coreResolve.call(this, p);
						if (
							this.defaultJSExtensions &&
							resolved.substr(resolved.length - 3, 3) !== '.js' &&
							!isPlain(resolved)
						) {
							resolved += '.js';
						}
						this[c][resolved] = this[c][resolved] || {};
						Object.assign(this[c][resolved], v[p]);
					} else if (c === 'depCache') {
						const defaultJSExtension =
							this.defaultJSExtensions &&
							p.substr(p.length - 3, 3) !== '.js';
						let prop = this.decanonicalize(p);
						if (defaultJSExtension && prop.substr(prop.length - 3, 3) === '.js') {
							prop = prop.substr(0, prop.length - 3);
						}
						this[c][prop] = [].concat(v[p]);
					} else this[c][p] = v[p];
				}
			}
		}

		envSet(this, cfg, c => this.config(c, true));
	};
}

export default {
	constructor,
	normalize,
	locate,
	fetch,
	import: _import,
	translate,
	instantiate,
	_nodeRequire,
	getConfig,
	config,
};
