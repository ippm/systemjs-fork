/*
 * Package Configuration Extension
 *
 * Example:
 *
 * SystemJS.packages = {
 *	 jquery: {
 *		 main: 'index.js', // when not set, package name is requested directly
 *		 format: 'amd',
 *		 defaultExtension: 'ts', // defaults to 'js', can be set to false
 *		 modules: {
 *			 '*.ts': {
 *				 loader: 'typescript'
 *			 },
 *			 'vendor/sizzle.js': {
 *				 format: 'global'
 *			 }
 *		 },
 *		 map: {
 *				// map internal require('sizzle') to local require('./vendor/sizzle')
 *				sizzle: './vendor/sizzle.js',
 *				// map any internal or external require of 'jquery/vendor/another' to 'another/index.js'
 *				'./vendor/another.js': './another/index.js',
 *				// test.js / test -> lib/test.js
 *				'./test.js': './lib/test.js',
 *
 *				// environment-specific map configurations
 *				'./index.js': {
 *					'~browser': './index-node.js',
 *					'./custom-condition.js|~export': './index-custom.js'
 *				}
 *		 },
 *		 // allows for setting package-prefixed depCache
 *		 // keys are normalized module names relative to the package itself
 *		 depCache: {
 *			 // import 'package/index.js' loads in parallel package/lib/test.js,package/vendor/sizzle.js
 *			 './index.js': ['./test'],
 *			 './test.js': ['external-dep'],
 *			 'external-dep/path.js': ['./another.js']
 *		 }
 *	 }
 * };
 *
 * Then:
 *	 import 'jquery'											 -> jquery/index.js
 *	 import 'jquery/submodule'						 -> jquery/submodule.js
 *	 import 'jquery/submodule.ts'					-> jquery/submodule.ts loaded as typescript
 *	 import 'jquery/vendor/another'				-> another/index.js
 *
 * Detailed Behaviours
 * - main can have a leading "./" can be added optionally
 * - map and defaultExtension are applied to the main
 * - defaultExtension adds the extension only if the exact extension is not present
 * - defaultJSExtensions applies after map when defaultExtension is not set
 * - if a meta value is available for a module, map and defaultExtension are skipped
 * - like global map, package map also applies to subpaths (sizzle/x, ./vendor/another/sub)
 * - condition module map is '@env' module in package or '@system-env' globally
 * - map targets support conditional interpolation ('./x': './x.#{|env}.js')
 * - internal package map targets cannot use boolean conditionals
 *
 * Package Configuration Loading
 *
 * Not all packages may already have their configuration present in the System config
 * For these cases, a list of packageConfigPaths can be provided, which when matched against
 * a request, will first request a ".json" file by the package name to derive the package
 * configuration from. This allows dynamic loading of non-predetermined code, a key use
 * case in SystemJS.
 *
 * Example:
 *
 *	 SystemJS.packageConfigPaths = ['packages/test/package.json', 'packages/*.json'];
 *
 *	 // will first request 'packages/new-package/package.json' for the package config
 *	 // before completing the package request to 'packages/new-package/path'
 *	 SystemJS.import('packages/new-package/path');
 *
 *	 // will first request 'packages/test/package.json' before the main
 *	 SystemJS.import('packages/test');
 *
 * When a package matches packageConfigPaths, it will always send a config request for
 * the package configuration.
 * The package name itself is taken to be the match up to and including the last wildcard
 * or trailing slash.
 * The most specific package config path will be used.
 * Any existing package configurations for the package will deeply merge with the
 * package config, with the existing package configurations taking preference.
 * To opt-out of the package configuration request for a package that matches
 * packageConfigPaths, use the { configured: true } package config option.
 *
 */

import {
	extendMeta,
	getMapMatch,
	parseCondition,
	setPkgConfig,
	readMemberExpression,
	interpolateConditional,
	warn,
} from '../utils';

/* eslint-disable no-param-reassign */

function constructor(next) {
	return function $constructor() {
		next.call(this);
		this.packages = {};
		this.packageConfigPaths = [];
	};
}

function getPackage(loader, normalized) {
	// use most specific package
	let curPkg;
	let curPkgLen = 0;
	let pkgLen;
	for (const p in loader.packages) {
		if (
			normalized.substr(0, p.length) === p &&
			(normalized.length === p.length || normalized[p.length] === '/')
		) {
			pkgLen = p.split('/').length;
			if (pkgLen > curPkgLen) {
				curPkg = p;
				curPkgLen = pkgLen;
			}
		}
	}
	return curPkg;
}

function getMetaMatches(pkgMeta, subPath, matchFn) {
	// wildcard meta
	for (let module in pkgMeta) {
		// allow meta to start with ./ for flexibility
		const dotRel = module.substr(0, 2) === './' ? './' : '';
		if (dotRel) module = module.substr(2);

		const wildcardIndex = module.indexOf('*');
		if (wildcardIndex === -1) continue;

		if (
			module.substr(0, wildcardIndex) === subPath.substr(0, wildcardIndex) &&
			module.substr(wildcardIndex + 1) ===
				subPath.substr(subPath.length - module.length + wildcardIndex + 1)
		) {
			// alow match function to return true for an exit path
			if (matchFn(module, pkgMeta[dotRel + module], module.split('/').length)) return;
		}
	}
	// exact meta
	const exactMeta =
		pkgMeta[subPath] &&
		pkgMeta.hasOwnProperty &&
		pkgMeta.hasOwnProperty(subPath) ? pkgMeta[subPath] : pkgMeta[`./${subPath}`];
	if (exactMeta) matchFn(exactMeta, exactMeta, 0);
}

function addDefaultExtension(loader, pkg, pkgName, subPath, skipExtensions) {
	// don't apply extensions to folders or if defaultExtension = false
	if (
		!subPath ||
		subPath[subPath.length - 1] === '/' ||
		skipExtensions || pkg.defaultExtension === false
	) {
		return subPath;
	}

	let metaMatch = false;
	// exact meta or meta with any content after the last wildcard skips extension
	if (pkg.meta) {
		getMetaMatches(pkg.meta, subPath, (metaPattern, matchMeta, matchDepth) => {
			if (matchDepth === 0 || metaPattern.lastIndexOf('*') !== metaPattern.length - 1) {
				metaMatch = true;
				return true;
			}
			return false;
		});
	}

	// exact global meta or meta with any content after the last wildcard skips extension
	if (!metaMatch && loader.meta) {
		getMetaMatches(loader.meta, `${pkgName}/${subPath}`, (metaPattern, matchMeta, matchDepth) => {
			if (matchDepth === 0 || metaPattern.lastIndexOf('*') !== metaPattern.length - 1) {
				metaMatch = true;
				return true;
			}
			return false;
		});
	}

	if (metaMatch) return subPath;

	// work out what the defaultExtension is and add if not there already
	// NB reconsider if default should really be ".js"?
	const defaultExtension = `.${pkg.defaultExtension || 'js'}`;
	if (subPath.substr(subPath.length - defaultExtension.length) !== defaultExtension) {
		return subPath + defaultExtension;
	}
	return subPath;
}

function validMapping(mapMatch, mapped, pkgName, path) {
	// disallow internal to subpath maps
	if (mapMatch === '.') {
		throw new Error(`Package ${pkgName} has a map entry for "." which is not permitted.`);
	}

	// allow internal ./x -> ./x/y or ./x/ -> ./x/y recursive maps
	// but only if the path is exactly ./x and not ./x/z
	if (mapped.substr(0, mapMatch.length) === mapMatch && path.length > mapMatch.length) return false;
	return true;
}

function doMapSync(loader, pkg, pkgName, mapMatch, path, skipExtensions) {
	if (path[path.length - 1] === '/') path = path.substr(0, path.length - 1);
	let mapped = pkg.map[mapMatch];

	if (typeof mapped === 'object') {
		throw new Error(`Synchronous conditional normalization not supported sync normalizing ${mapMatch} in ${pkgName}`);
	}

	if (!validMapping(mapMatch, mapped, pkgName, path) || typeof mapped !== 'string') {
		return undefined;
	}

	// package map to main / base-level
	if (mapped === '.') mapped = pkgName;
	else if (mapped.substr(0, 2) === './') {
		// internal package map
		return `${pkgName}/${addDefaultExtension(loader, pkg, pkgName, mapped.substr(2) + path.substr(mapMatch.length), skipExtensions)}`;
	}

	// external map reference
	return loader.normalizeSync(mapped + path.substr(mapMatch.length), `${pkgName}/`);
}

function applyPackageConfigSync(loader, pkg, pkgName, subPath, skipExtensions) {
	// main
	if (!subPath) {
		if (pkg.main) subPath = pkg.main.substr(0, 2) === './' ? pkg.main.substr(2) : pkg.main;
		else {
			// also no submap if name is package itself (import 'pkg' -> 'path/to/pkg.js')
			// NB can add a default package main convention here when defaultJSExtensions is deprecated
			// if it becomes internal to the package then it would no longer be an exit path
			return pkgName + (loader.defaultJSExtensions ? '.js' : '');
		}
	}

	// map config checking without then with extensions
	if (pkg.map) {
		let mapPath = `./${subPath}`;
		let mapMatch = getMapMatch(pkg.map, mapPath);

		// we then check map with the default extension adding
		if (!mapMatch) {
			mapPath = `./${addDefaultExtension(loader, pkg, pkgName, subPath, skipExtensions)}`;
			if (mapPath !== `./${subPath}`) mapMatch = getMapMatch(pkg.map, mapPath);
		}
		if (mapMatch) {
			const mapped = doMapSync(loader, pkg, pkgName, mapMatch, mapPath, skipExtensions);
			if (mapped) return mapped;
		}
	}

	// normal package resolution
	return `${pkgName}/${addDefaultExtension(loader, pkg, pkgName, subPath, skipExtensions)}`;
}

function doStringMap(loader, pkg, pkgName, mapMatch, mapped, path, skipExtensions) {
	// NB the interpolation cases should strictly skip subsequent interpolation
	// package map to main / base-level
	if (mapped === '.') mapped = pkgName;
	else if (mapped.substr(0, 2) === './') {
		// internal package map
		return Promise.resolve(interpolateConditional.call(
			loader,
			`${pkgName}/${addDefaultExtension(loader, pkg, pkgName, mapped.substr(2) + path.substr(mapMatch.length), skipExtensions)}`,
			`${pkgName}/`
		));
	}

	// external map reference
	return loader.normalize(mapped + path.substr(mapMatch.length), `${pkgName}/`);
}

function doMap(loader, pkg, pkgName, mapMatch, path, skipExtensions) {
	if (path[path.length - 1] === '/') path = path.substr(0, path.length - 1);

	const mapped = pkg.map[mapMatch];

	if (typeof mapped === 'string') {
		if (!validMapping(mapMatch, mapped, pkgName, path)) return Promise.resolve();
		return doStringMap(loader, pkg, pkgName, mapMatch, mapped, path, skipExtensions);
	}

	// we use a special conditional syntax to allow the builder to handle conditional
	// branch points further
	if (loader.builder) return Promise.resolve(`${pkgName}/#:${path}`);

	// we load all conditions upfront
	const conditionPromises = [];
	const conditions = [];
	for (const e in mapped) {
		const c = parseCondition(e);
		conditions.push({
			condition: c,
			map: mapped[e],
		});
		conditionPromises.push(loader.import(c.module, pkgName));
	}

	// map object -> conditional map
	return Promise.all(conditionPromises)
		.then(conditionValues => {
			// first map condition to match is used
			for (let i = 0; i < conditions.length; i++) {
				const c = conditions[i].condition;
				const value = readMemberExpression(c.prop, conditionValues[i]);
				if (!c.negate && value || c.negate && !value) return conditions[i].map;
			}
			return undefined;
		})
		.then(mapped2 => {
			if (mapped2) {
				if (!validMapping(mapMatch, mapped2, pkgName, path)) return undefined;
				return doStringMap(loader, pkg, pkgName, mapMatch, mapped2, path, skipExtensions);
			}
			// no environment match -> fallback to original subPath by returning undefined
			return undefined;
		});
}

function applyPackageConfig(loader, pkg, pkgName, subPath, skipExtensions) {
	// main
	if (!subPath) {
		if (pkg.main) subPath = pkg.main.substr(0, 2) === './' ? pkg.main.substr(2) : pkg.main;
		else {
			// also no submap if name is package itself (import 'pkg' -> 'path/to/pkg.js')
			// NB can add a default package main convention here when defaultJSExtensions is deprecated
			// if it becomes internal to the package then it would no longer be an exit path
			return Promise.resolve(pkgName + (loader.defaultJSExtensions ? '.js' : ''));
		}
	}

	// map config checking without then with extensions
	let mapPath;
	let mapMatch;

	if (pkg.map) {
		mapPath = `./${subPath}`;
		mapMatch = getMapMatch(pkg.map, mapPath);

		// we then check map with the default extension adding
		if (!mapMatch) {
			mapPath = `./${addDefaultExtension(loader, pkg, pkgName, subPath, skipExtensions)}`;
			if (mapPath !== `./${subPath}`) mapMatch = getMapMatch(pkg.map, mapPath);
		}
	}

	let p;
	if (mapMatch) p = doMap(loader, pkg, pkgName, mapMatch, mapPath, skipExtensions);
	else p = Promise.resolve();

	return p.then(mapped => {
		if (mapped) return mapped;

		// normal package resolution / fallback resolution for no conditional match
		return `${pkgName}/${addDefaultExtension(loader, pkg, pkgName, subPath, skipExtensions)}`;
	});
}

// decanonicalize must JUST handle package defaultExtension: false case when
// defaultJSExtensions is set to be deprecated!
function decanonicalize(next) {
	return function $decanonicalize(name, parentName) {
		if (this.builder) return next.call(this, name, parentName, true);

		let decanonicalized = next.call(this, name, parentName, false);
		if (!this.defaultJSExtensions) return decanonicalized;

		const pkgName = getPackage(this, decanonicalized);

		const pkg = this.packages[pkgName];
		let defaultExtension = pkg && pkg.defaultExtension;

		if (defaultExtension === undefined && pkg && pkg.meta) {
			getMetaMatches(
				pkg.meta,
				decanonicalized.substr(pkgName),
				(metaPattern, matchMeta, matchDepth) => {
					if (matchDepth === 0 || metaPattern.lastIndexOf('*') !== metaPattern.length - 1) {
						defaultExtension = false;
						return true;
					}
					return false;
				}
			);
		}

		if (
			(defaultExtension === false || defaultExtension && defaultExtension !== '.js') &&
			name.substr(name.length - 3, 3) !== '.js' &&
			decanonicalized.substr(decanonicalized.length - 3, 3) === '.js'
		) {
			decanonicalized = decanonicalized.substr(0, decanonicalized.length - 3);
		}

		return decanonicalized;
	};
}

// check if the given normalized name matches a packageConfigPath
// if so, loads the config
const packageConfigPaths = {};


// data object for quick checks against package paths
function createPkgConfigPathObj(path) {
	const lastWildcard = path.lastIndexOf('*');
	const length = Math.max(lastWildcard + 1, path.lastIndexOf('/'));
	const regex = path
		.substr(0, length)
		.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
		.replace(/\*/g, '[^\\/]+');
	return {
		length,
		regEx: new RegExp(`^(${regex})(\\/|$)`),
		wildcard: lastWildcard !== -1,
	};
}

function loadPackageConfigPath(loader, pkgName, pkgConfigPath) {
	const configLoader = loader.pluginLoader || loader;

	// NB remove this when json is default
	configLoader.meta[pkgConfigPath] = configLoader.meta[pkgConfigPath] || {};
	configLoader.meta[pkgConfigPath].format = 'json';
	configLoader.meta[pkgConfigPath].loader = null;

	return configLoader.load(pkgConfigPath).then(() => {
		let cfg = configLoader.get(pkgConfigPath).default;

		// support "systemjs" prefixing
		if (cfg.systemjs) cfg = cfg.systemjs;

		// modules backwards compatibility
		if (cfg.modules) {
			cfg.meta = cfg.modules;
			warn.call(
				loader,
				`Package config file ${pkgConfigPath} is configured with "modules", which is deprecated as it has been renamed to "meta".`
			);
		}

		return setPkgConfig(loader, pkgName, cfg, true);
	});
}

// most specific match wins
function getPackageConfigMatch(loader, normalized) {
	let pkgName;
	let exactMatch = false;
	let configPath;
	for (let i = 0; i < loader.packageConfigPaths.length; i++) {
		const packageConfigPath = loader.packageConfigPaths[i];
		let p = packageConfigPaths[packageConfigPath];
		if (!p) {
			p = createPkgConfigPathObj(packageConfigPath);
			packageConfigPaths[packageConfigPath] = p;
		}
		if (normalized.length < p.length) continue;
		const match = normalized.match(p.regEx);
		if (match && (!pkgName || (!(exactMatch && p.wildcard) && pkgName.length < match[1].length))) {
			pkgName = match[1];
			exactMatch = !p.wildcard;
			configPath = pkgName + packageConfigPath.substr(p.length);
		}
	}

	if (!pkgName) return undefined;

	return {
		packageName: pkgName,
		configPath,
	};
}

function normalizeSync(next) {
	return function $normalizeSync(name, parentName, isPlugin) {
		const loader = this;
		isPlugin = isPlugin === true;

		// apply contextual package map first
		// (we assume the parent package config has already been loaded)
		let parentPackageName;
		if (parentName) {
			parentPackageName =
				getPackage(loader, parentName) ||
				loader.defaultJSExtensions && parentName.substr(parentName.length - 3, 3) === '.js' &&
				getPackage(loader, parentName.substr(0, parentName.length - 3));
		}

		const parentPackage = parentPackageName && loader.packages[parentPackageName];

		// ignore . since internal maps handled by standard package resolution
		if (parentPackage && name[0] !== '.') {
			const parentMap = parentPackage.map;
			const parentMapMatch = parentMap && getMapMatch(parentMap, name);

			if (parentMapMatch && typeof parentMap[parentMapMatch] === 'string') {
				const mapped = doMapSync(
					loader, parentPackage, parentPackageName, parentMapMatch, name, isPlugin
				);
				if (mapped) return mapped;
			}
		}

		let defaultJSExtension =
			loader.defaultJSExtensions &&
			name.substr(name.length - 3, 3) !== '.js';

		// apply map, core, paths, contextual package map
		let normalized = next.call(loader, name, parentName, false);

		// undo defaultJSExtension
		if (defaultJSExtension && normalized.substr(normalized.length - 3, 3) !== '.js') {
			defaultJSExtension = false;
		}
		if (defaultJSExtension) normalized = normalized.substr(0, normalized.length - 3);

		const pkgConfigMatch = getPackageConfigMatch(loader, normalized);
		const pkgName = pkgConfigMatch && pkgConfigMatch.packageName || getPackage(loader, normalized);

		if (!pkgName) return normalized + (defaultJSExtension ? '.js' : '');

		const subPath = normalized.substr(pkgName.length + 1);

		return applyPackageConfigSync(
			loader,
			loader.packages[pkgName] || {},
			pkgName,
			subPath,
			isPlugin
		);
	};
}

function normalize(next) {
	return function $normalize(name, parentName, isPlugin) {
		const loader = this;
		isPlugin = isPlugin === true;

		return Promise.resolve()
			.then(() => {
				// apply contextual package map first
				// (we assume the parent package config has already been loaded)
				let parentPackageName;
				if (parentName) {
					parentPackageName =
						getPackage(loader, parentName) ||
						loader.defaultJSExtensions && parentName.substr(parentName.length - 3, 3) === '.js' &&
						getPackage(loader, parentName.substr(0, parentName.length - 3));
				}

				const parentPackage = parentPackageName && loader.packages[parentPackageName];

				// ignore . since internal maps handled by standard package resolution
				if (parentPackage && name.substr(0, 2) !== './') {
					const parentMap = parentPackage.map;
					const parentMapMatch = parentMap && getMapMatch(parentMap, name);

					if (parentMapMatch) {
						return doMap(loader, parentPackage, parentPackageName, parentMapMatch, name, isPlugin);
					}
				}

				return undefined;
			})
			.then((mapped) => {
				if (mapped) return mapped;

				let defaultJSExtension =
					loader.defaultJSExtensions &&
					name.substr(name.length - 3, 3) !== '.js';

				// apply map, core, paths, contextual package map
				let normalized = next.call(loader, name, parentName, false);

				// undo defaultJSExtension
				if (defaultJSExtension && normalized.substr(normalized.length - 3, 3) !== '.js') {
					defaultJSExtension = false;
				}
				if (defaultJSExtension) normalized = normalized.substr(0, normalized.length - 3);

				const pkgConfigMatch = getPackageConfigMatch(loader, normalized);
				const pkgName =
					pkgConfigMatch &&
					pkgConfigMatch.packageName ||
					getPackage(loader, normalized);

				if (!pkgName) return normalized + (defaultJSExtension ? '.js' : '');

				const pkg = loader.packages[pkgName];

				// if package is already configured or not a dynamic config package, use existing package config
				const isConfigured = pkg && (pkg.configured || !pkgConfigMatch);
				return (
					isConfigured ?
					Promise.resolve(pkg) :
					loadPackageConfigPath(loader, pkgName, pkgConfigMatch.configPath)
				).then(pkg2 => {
					const subPath = normalized.substr(pkgName.length + 1);
					return applyPackageConfig(loader, pkg2, pkgName, subPath, isPlugin);
				});
			});
	};
}

function locate(next) {
	return function $locate(load) {
		const loader = this;
		return Promise.resolve(next.call(this, load)).then(address => {
			const pkgName = getPackage(loader, load.name);
			if (pkgName) {
				const pkg = loader.packages[pkgName];
				const subPath = load.name.substr(pkgName.length + 1);

				const meta = {};
				if (pkg.meta) {
					let bestDepth = 0;

					// NB support a main shorthand in meta here?
					getMetaMatches(pkg.meta, subPath, (metaPattern, matchMeta, matchDepth) => {
						if (matchDepth > bestDepth) bestDepth = matchDepth;
						extendMeta(meta, matchMeta, matchDepth && bestDepth > matchDepth);
					});

					extendMeta(load.metadata, meta);
				}

				// format
				if (pkg.format && !load.metadata.loader) {
					load.metadata.format = load.metadata.format || pkg.format;
				}
			}

			return address;
		});
	};
}

// TODO: WTF?!
// normalizeSync = decanonicalize + package resolution
// SystemJSLoader.prototype.decanonicalize = SystemJSLoader.prototype.normalize;
// SystemJSLoader.prototype.normalizeSync = SystemJSLoader.prototype.normalize;

export default {
	constructor,
	decanonicalize,
	normalizeSync,
	normalize,
	locate,
};
