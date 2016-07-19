/*
 * Instantiate registry extension
 *
 * Supports Traceur System.register 'instantiate' output for loading ES6 as ES5.
 *
 * - Creates the loader.register function
 * - Also supports metadata.format = 'register' in instantiate for anonymous register modules
 * - Also supports metadata.deps, metadata.execute and metadata.executingRequire
 *		 for handling dynamic modules alongside register-transformed ES6 modules
 *
 *
 * The code here replicates the ES6 linking groups algorithm to ensure that
 * circular ES6 compiled into System.register can work alongside circular AMD
 * and CommonJS, identically to the actual ES6 loader.
 *
 */


/*
 * Registry side table entries in loader.defined
 * Registry Entry Contains:
 *		- name
 *		- deps
 *		- declare for declarative modules
 *		- execute for dynamic modules, different to declarative execute on module
 *		- executingRequire indicates require drives execution for circularity of dynamic modules
 *		- declarative optional boolean indicating which of the above
 *
 * Can preload modules directly on SystemJS.defined['my/module'] = {deps, execute, executingRequire}
 *
 * Then the entry gets populated with derived information during processing:
 *		- normalizedDeps derived from deps, created in instantiate
 *		- groupIndex used by group linking algorithm
 *		- evaluated indicating whether evaluation has happend
 *		- module the module record object, containing:
 *			- exports actual module exports
 *
 *		For dynamic we track the es module with:
 *		- esModule actual es module value
 *		- esmExports whether to extend the esModule with named exports
 *
 *		Then for declarative only we track dynamic bindings with the 'module' records:
 *			- name
 *			- exports
 *			- setters declarative setter functions
 *			- dependencies, module records of dependencies
 *			- importers, module records of dependents
 *
 * After linked and evaluated, entries are removed, declarative module records remain in separate
 * module binding table
 *
 */

import {
	__global,
	exec as __exec,
	createEntry,
	Module,
	getESModule,
	group,
} from '../utils';

/* eslint-disable no-param-reassign */

const leadingCommentAndMetaRegEx = /^(\s*\/\*[^\*]*(\*(?!\/)[^\*]*)*\*\/|\s*\/\/[^\n]*|\s*"[^"]+"\s*;?|\s*'[^']+'\s*;?)*\s*/;
function detectRegisterFormat(source) {
	const leadingCommentAndMeta = source.match(leadingCommentAndMetaRegEx);
	if (!leadingCommentAndMeta) return false;
	return source.substr(leadingCommentAndMeta[0].length, 15) === 'System.register';
}

function constructor(next) {
	return function $constructor() {
		next.call(this);

		this.defined = {};
		this._loader.moduleRecords = {};
	};
}

/*
 * There are two variations of System.register:
 * 1. System.register for ES6 conversion (2-3 params) - System.register([name, ]deps, declare)
 *		see https://github.com/ModuleLoader/es6-module-loader/wiki/System.register-Explained
 *
 * 2. System.registerDynamic for dynamic modules (3-4 params) -
 * System.registerDynamic([name, ]deps, executingRequire, execute) the true or false statement
 *
 * this extension implements the linking algorithm for the two variations identical to the spec
 * allowing compiled ES6 circular references to work alongside AMD and CJS circular references.
 *
 */
function register() {
	return function $register(name, deps, declare) {
		if (typeof name !== 'string') {
			declare = deps;
			deps = name;
			name = null;
		}

		// dynamic backwards-compatibility
		// can be deprecated eventually
		if (typeof declare === 'boolean') return this.registerDynamic.apply(this, arguments);

		const entry = createEntry();
		// ideally wouldn't apply map config to bundle names but
		// dependencies go through map regardless so we can't restrict
		// could reconsider in shift to new spec
		entry.name = name && (this.decanonicalize || this.normalize).call(this, name);
		entry.declarative = true;
		entry.deps = deps;
		entry.declare = declare;

		this.pushRegister_({
			amd: false,
			entry,
		});
	};
}

function registerDynamic() {
	return function $registerDynamic(name, deps, declare, execute) {
		if (typeof name !== 'string') {
			execute = declare;
			declare = deps;
			deps = name;
			name = null;
		}

		// dynamic
		const entry = createEntry();
		entry.name = name && (this.decanonicalize || this.normalize).call(this, name);
		entry.deps = deps;
		entry.execute = execute;
		entry.executingRequire = declare;

		this.pushRegister_({
			amd: false,
			entry,
		});
	};
}

function reduceRegister_() {
	// eslint-disable-next-line no-shadow
	return function $reduceRegister_(load, register) {
		if (!register) return;

		const entry = register.entry;
		const curMeta = load && load.metadata;

		// named register
		if (entry.name) {
			if (!(entry.name in this.defined)) this.defined[entry.name] = entry;

			if (curMeta) curMeta.bundle = true;
		}
		// anonymous register
		if (!entry.name || load && !curMeta.entry && entry.name === load.name) {
			if (!curMeta) {
				throw new TypeError('Invalid System.register call. Anonymous System.register calls can only be made by modules loaded by SystemJS.import and not via script tags.');
			}
			if (curMeta.entry) {
				if (curMeta.format === 'register') {
					throw new Error(`Multiple anonymous System.register calls in module ${load.name}. If loading a bundle, ensure all the System.register calls are named.`);
				} else {
					throw new Error(`Module ${load.name} interpreted as ${curMeta.format} module format, but called System.register.`);
				}
			}
			if (!curMeta.format) curMeta.format = 'register';
			curMeta.entry = entry;
		}
	};
}

function buildGroups(entry, loader, groups) {
	groups[entry.groupIndex] = groups[entry.groupIndex] || [];

	if (groups[entry.groupIndex].indexOf(entry) !== -1) return;

	groups[entry.groupIndex].push(entry);

	for (let i = 0, l = entry.normalizedDeps.length; i < l; i++) {
		const depName = entry.normalizedDeps[i];
		const depEntry = loader.defined[depName];

		// not in the registry means already linked / ES6
		if (!depEntry || depEntry.evaluated) continue;

		// now we know the entry is in our unlinked linkage group
		const depGroupIndex = entry.groupIndex + (depEntry.declarative !== entry.declarative);

		// the group index of an entry is always the maximum
		if (depEntry.groupIndex === null || depEntry.groupIndex < depGroupIndex) {
			// if already in a group, remove from the old group
			if (depEntry.groupIndex !== null) {
				groups[depEntry.groupIndex].splice(groups[depEntry.groupIndex].indexOf(depEntry), 1);

				// if the old group is empty, then we have a mixed depndency cycle
				if (groups[depEntry.groupIndex].length === 0) {
					throw new Error('Mixed dependency cycle detected');
				}
			}

			depEntry.groupIndex = depGroupIndex;
		}

		buildGroups(depEntry, loader, groups);
	}
}

// module binding records
function ModuleRecord() {}
Object.defineProperty(ModuleRecord, 'toString', {
	value() {
		return 'Module';
	},
});

function getOrCreateModuleRecord(name, moduleRecords) {
	return moduleRecords[name] || (moduleRecords[name] = {
		name,
		dependencies: [],
		exports: new ModuleRecord(), // start from an empty module and extend
		importers: [],
	});
}

function linkDeclarativeModule(entry, loader) {
	// only link if already not already started linking (stops at circular)
	if (entry.module) return;

	const moduleRecords = loader._loader.moduleRecords;
	const module = entry.module = getOrCreateModuleRecord(entry.name, moduleRecords);
	const exports = entry.module.exports;

	const declaration = entry.declare.call(
		__global,
		(name, value) => {
			module.locked = true;

			if (typeof name === 'object') {
				for (const p in name) exports[p] = name[p];
			} else exports[name] = value;

			for (let i = 0, l = module.importers.length; i < l; i++) {
				const importerModule = module.importers[i];
				if (!importerModule.locked) {
					const importerIndex = importerModule.dependencies.indexOf(module);
					importerModule.setters[importerIndex](exports);
				}
			}

			module.locked = false;
			return value;
		},
		{id: entry.name}
	);

	module.setters = declaration.setters;
	module.execute = declaration.execute;

	if (!module.setters || !module.execute) {
		throw new TypeError(`Invalid System.register form for ${entry.name}`);
	}

	// now link all the module dependencies
	for (let i = 0, l = entry.normalizedDeps.length; i < l; i++) {
		const depName = entry.normalizedDeps[i];
		const depEntry = loader.defined[depName];
		let depModule = moduleRecords[depName];

		// work out how to set depExports based on scenarios...
		let depExports;
		if (depModule) depExports = depModule.exports;
		else if (depEntry && !depEntry.declarative) {
			// dynamic, already linked in our registry
			depExports = depEntry.esModule;
		} else if (!depEntry) {
			// in the loader registry
			depExports = loader.get(depName);
		} else {
			// we have an entry -> link
			linkDeclarativeModule(depEntry, loader);
			depModule = depEntry.module;
			depExports = depModule.exports;
		}

		// only declarative modules have dynamic bindings
		if (depModule && depModule.importers) {
			depModule.importers.push(module);
			module.dependencies.push(depModule);
		} else module.dependencies.push(null);

		// run setters for all entries with the matching dependency name
		const originalIndices = entry.originalIndices[i];
		for (let j = 0, len = originalIndices.length; j < len; ++j) {
			const index = originalIndices[j];
			if (module.setters[index]) module.setters[index](depExports);
		}
	}
}

/*
 * Given a module, and the list of modules for this current branch,
 *	ensure that each of the dependencies of this module is evaluated
 *	(unless one is a circular dependency already in the list of seen
 *	modules, in which case we execute it)
 *
 * Then we evaluate the module itself depth-first left to right
 * execution to match ES6 modules
 */
function ensureEvaluated(moduleName, entry, seen, loader) {
	// if already seen, that means it's an already-evaluated non circular dependency
	if (!entry || entry.evaluated || !entry.declarative) return;

	// this only applies to declarative modules which late-execute

	seen.push(moduleName);

	for (let i = 0, l = entry.normalizedDeps.length; i < l; i++) {
		const depName = entry.normalizedDeps[i];
		if (seen.indexOf(depName) === -1) {
			if (!loader.defined[depName]) loader.get(depName);
			else ensureEvaluated(depName, loader.defined[depName], seen, loader);
		}
	}

	if (entry.evaluated) return;

	entry.evaluated = true;
	entry.module.execute.call(__global);
}

// An analog to loader.get covering execution of all three layers (real declarative, simulated declarative, simulated dynamic)
function getModule(name, loader) {
	let exports;
	const entry = loader.defined[name];

	if (!entry) {
		exports = loader.get(name);
		if (!exports) throw new Error(`Unable to load dependency ${name}.`);
	} else {
		if (entry.declarative) ensureEvaluated(name, entry, [], loader);
		else if (!entry.evaluated) {
			// eslint-disable-next-line no-use-before-define
			linkDynamicModule(entry, loader);
		}

		exports = entry.module.exports;
	}

	if ((!entry || entry.declarative) && exports && exports.__useDefault) return exports.default;

	return exports;
}

function linkDynamicModule(entry, loader) {
	if (entry.module) return;

	let exports = {};

	const module = entry.module = {exports, id: entry.name};

	// AMD requires execute the tree first
	if (!entry.executingRequire) {
		for (let i = 0, l = entry.normalizedDeps.length; i < l; i++) {
			const depName = entry.normalizedDeps[i];
			// we know we only need to link dynamic due to linking algorithm
			const depEntry = loader.defined[depName];
			if (depEntry) linkDynamicModule(depEntry, loader);
		}
	}

	// now execute
	entry.evaluated = true;
	const output = entry.execute.call(
		__global,
		name => {
			for (let i = 0, l = entry.deps.length; i < l; i++) {
				if (entry.deps[i] !== name) continue;
				return getModule(entry.normalizedDeps[i], loader);
			}
			// try and normalize the dependency to see if we have another form
			const nameNormalized = loader.normalizeSync(name, entry.name);
			if (entry.normalizedDeps.indexOf(nameNormalized) !== -1) {
				return getModule(nameNormalized, loader);
			}

			throw new Error(`Module ${name} not declared as a dependency of ${entry.name}`);
		},
		exports,
		module
	);

	if (output) module.exports = output;

	// create the esModule object, which allows ES6 named imports of dynamics
	exports = module.exports;

	// __esModule flag treats as already-named
	if (exports && (exports.__esModule || exports instanceof Module)) {
		entry.esModule = loader.newModule(exports);
	} else if (entry.esmExports && exports !== __global) {
		// set module as 'default' export, then fake named exports by iterating properties
		entry.esModule = loader.newModule(getESModule(exports));
	} else {
		// just use the 'default' export
		entry.esModule = loader.newModule({default: exports});
	}
}

function link(name, startEntry, loader) {
	// skip if already linked
	if (startEntry.module) return;

	startEntry.groupIndex = 0;

	const groups = [];

	buildGroups(startEntry, loader, groups);

	let curGroupDeclarative = !!startEntry.declarative === groups.length % 2;
	for (let i = groups.length - 1; i >= 0; i--) {
		const group = groups[i];
		for (let j = 0; j < group.length; j++) {
			const entry = group[j];

			// link each group
			if (curGroupDeclarative) linkDeclarativeModule(entry, loader);
			else linkDynamicModule(entry, loader);
		}
		curGroupDeclarative = !curGroupDeclarative;
	}
}

// override the delete method to also clear the register caches
function _delete(next) {
	return function $delete(name) {
		delete this._loader.moduleRecords[name];
		delete this.defined[name];
		return next.call(this, name);
	};
}

function fetch(next) {
	// eslint-disable-next-line no-shadow
	return function $fetch(load) {
		if (this.defined[load.name]) {
			load.metadata.format = 'defined';
			return '';
		}

		load.metadata.deps = load.metadata.deps || [];

		return next.call(this, load);
	};
}

function translate(next) {
	// we run the meta detection here (register is after meta)
	// eslint-disable-next-line no-shadow
	return function $translate(load) {
		load.metadata.deps = load.metadata.deps || [];
		return Promise.resolve(next.apply(this, arguments)).then(source => {
			// run detection for register format
			if (
				load.metadata.format === 'register' ||
				!load.metadata.format && detectRegisterFormat(load.source)
			) {
				load.metadata.format = 'register';
			}
			return source;
		});
	};
}

// implement a perforance shortpath for System.load with no deps
function load(next) {
	return function $load(normalized) {
		const loader = this;
		const entry = loader.defined[normalized];

		if (!entry || entry.deps.length) return next.apply(this, arguments);

		entry.originalIndices = entry.normalizedDeps = [];

		// recursively ensure that the module and all its
		// dependencies are linked (with dependency group handling)
		link(normalized, entry, loader);

		// now handle dependency execution in correct order
		ensureEvaluated(normalized, entry, [], loader);
		if (!entry.esModule) entry.esModule = loader.newModule(entry.module.exports);

		// remove from the registry
		if (!loader.trace) loader.defined[normalized] = undefined;

		// return the defined module object
		loader.set(normalized, entry.esModule);

		return Promise.resolve();
	};
}

function instantiate(next) {
	// eslint-disable-next-line no-shadow
	return function $instantiate(load) {
		if (load.metadata.format === 'detect') load.metadata.format = undefined;

		// assumes previous instantiate is sync
		// (core json support)
		next.call(this, load);

		const loader = this;

		let entry;

		// first we check if this module has already been defined in the registry
		if (loader.defined[load.name]) {
			entry = loader.defined[load.name];
			// don't support deps for ES modules
			if (!entry.declarative) entry.deps = entry.deps.concat(load.metadata.deps);
			entry.deps = entry.deps.concat(load.metadata.deps);
		} else if (load.metadata.entry) {
			// picked up already by an anonymous System.register script injection
			// or via the dynamic formats
			entry = load.metadata.entry;
			entry.deps = entry.deps.concat(load.metadata.deps);
		} else if (
				!(loader.builder && load.metadata.bundle) &&
				(
					load.metadata.format === 'register' ||
					load.metadata.format === 'esm' ||
					load.metadata.format === 'es6'
				)
			) {
				// Contains System.register calls
				// (dont run bundles in the builder)

			if (typeof __exec !== 'undefined') __exec.call(loader, load); // TODO: wtf

			if (!load.metadata.entry && !load.metadata.bundle) {
				throw new Error(`${load.name} detected as ${load.metadata.format} but didn't execute.`);
			}

			entry = load.metadata.entry;

			// support metadata deps for System.register
			if (entry && load.metadata.deps) entry.deps = entry.deps.concat(load.metadata.deps);
		}

		// named bundles are just an empty module
		if (!entry) {
			entry = createEntry();
			entry.deps = load.metadata.deps;
			entry.execute = () => {};
		}

		// place this module onto defined for circular references
		loader.defined[load.name] = entry;

		const grouped = group(entry.deps);

		entry.deps = grouped.names;
		entry.originalIndices = grouped.indices;
		entry.name = load.name;
		entry.esmExports = load.metadata.esmExports !== false;

		// first, normalize all dependencies
		const normalizePromises = [];
		for (let i = 0, l = entry.deps.length; i < l; i++) {
			normalizePromises.push(Promise.resolve(loader.normalize(entry.deps[i], load.name)));
		}

		return Promise.all(normalizePromises).then(normalizedDeps => {
			entry.normalizedDeps = normalizedDeps;

			return {
				deps: entry.deps,
				execute() {
					// recursively ensure that the module and all its
					// dependencies are linked (with dependency group handling)
					link(load.name, entry, loader);

					// now handle dependency execution in correct order
					ensureEvaluated(load.name, entry, [], loader);

					if (!entry.esModule) entry.esModule = loader.newModule(entry.module.exports);

					// remove from the registry
					if (!loader.trace) loader.defined[load.name] = undefined;

					// return the defined module object
					return entry.esModule;
				},
			};
		});
	};
}

export default {
	constructor,
	register,
	registerDynamic,
	reduceRegister_,
	delete: _delete,
	fetch,
	translate,
	load,
	instantiate,
};
