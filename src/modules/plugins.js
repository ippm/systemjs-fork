/*
	SystemJS Loader Plugin Support

	Supports plugin loader syntax with "!", or via metadata.loader

	The plugin name is loaded as a module itself, and can override standard loader hooks
	for the plugin resource. See the plugin section of the systemjs readme.
*/

import {warn, createEntry} from '../utils';

/* eslint-disable no-param-reassign */

function getParentName(loader, parentName) {
	// if parent is a plugin, normalize against the parent plugin argument only
	if (parentName) {
		if (loader.pluginFirst) {
			const parentPluginIndex = parentName.lastIndexOf('!');
			if (parentPluginIndex !== -1) return parentName.substr(parentPluginIndex + 1);
		} else {
			const parentPluginIndex = parentName.lastIndexOf('!');
			if (parentPluginIndex !== -1) return parentName.substr(0, parentPluginIndex);
		}
		return parentName;
	}
	return undefined;
}

function parsePlugin(loader, name) {
	let argumentName;
	let pluginName;

	const pluginIndex = name.lastIndexOf('!');
	if (pluginIndex === -1) return undefined;

	if (loader.pluginFirst) {
		argumentName = name.substr(pluginIndex + 1);
		pluginName = name.substr(0, pluginIndex);
	} else {
		argumentName = name.substr(0, pluginIndex);
		pluginName =
			name.substr(pluginIndex + 1) ||
			argumentName.substr(argumentName.lastIndexOf('.') + 1);
	}

	return {
		argument: argumentName,
		plugin: pluginName,
	};
}

// put name back together after parts have been normalized
function combinePluginParts(loader, argumentName, pluginName, defaultExtension) {
	if (defaultExtension && argumentName.substr(argumentName.length - 3, 3) === '.js') {
		argumentName = argumentName.substr(0, argumentName.length - 3);
	}

	if (loader.pluginFirst) return `${pluginName}!${argumentName}`;
	return `${argumentName}!${pluginName}`;
}

// note if normalize will add a default js extension
// if so, remove for backwards compat
// this is strange and sucks, but will be deprecated
function checkDefaultExtension(loader, arg) {
	return loader.defaultJSExtensions && arg.substr(arg.length - 3, 3) !== '.js';
}

// handler for "decanonicalize" and "normalizeSync"
function createNormalizeSync(next) {
	return function $createNormalizeSync(name, parentName, isPlugin) {
		const loader = this;

		const parsed = parsePlugin(loader, name);
		parentName = getParentName(this, parentName);

		if (!parsed) return next.call(this, name, parentName, isPlugin);

		// if this is a plugin, normalize the plugin name and the argument
		const argumentName = loader.normalizeSync(parsed.argument, parentName, true);
		const pluginName = loader.normalizeSync(parsed.plugin, parentName, true);
		return combinePluginParts(
			loader,
			argumentName,
			pluginName,
			checkDefaultExtension(loader, parsed.argument)
		);
	};
}

function normalize(next) {
	return function $normalize(name, parentName, isPlugin) {
		const loader = this;

		parentName = getParentName(this, parentName);

		const parsed = parsePlugin(loader, name);

		if (!parsed) return next.call(loader, name, parentName, isPlugin);

		return Promise.all([
			loader.normalize(parsed.argument, parentName, true),
			loader.normalize(parsed.plugin, parentName, false),
		])
			.then(normalized => combinePluginParts(
				loader,
				normalized[0],
				normalized[1],
				checkDefaultExtension(loader, parsed.argument)
			));
	};
}

function locate(next) {
	return function $locate(load) {
		const loader = this;

		const {name} = load;

		// plugin syntax
		let pluginSyntaxIndex;
		if (loader.pluginFirst) {
			pluginSyntaxIndex = name.indexOf('!');
			if (pluginSyntaxIndex !== -1) {
				load.metadata.loader = name.substr(0, pluginSyntaxIndex);
				load.name = name.substr(pluginSyntaxIndex + 1);
			}
		} else {
			pluginSyntaxIndex = name.lastIndexOf('!');
			if (pluginSyntaxIndex !== -1) {
				load.metadata.loader = name.substr(pluginSyntaxIndex + 1);
				load.name = name.substr(0, pluginSyntaxIndex);
			}
		}

		return next.call(loader, load)
			.then(address => {
				if (pluginSyntaxIndex !== -1 || !load.metadata.loader) return address;

				// normalize plugin relative to parent in locate here when
				// using plugin via loader metadata
				return (loader.pluginLoader || loader)
					.normalize(load.metadata.loader, load.name)
					.then(loaderNormalized => {
						load.metadata.loader = loaderNormalized;
						const plugin = load.metadata.loader;
						if (!plugin) return address;

						// don't allow a plugin to load itself
						if (load.name === plugin) {
							throw new Error(`Plugin ${plugin} cannot load itself, make sure it is excluded from any wildcard meta configuration via a custom loader: false rule.`);
						}

						// only fetch the plugin itself if this name isn't defined
						if (loader.defined && loader.defined[name]) return address;

						const pluginLoader = loader.pluginLoader || loader;

						// load the plugin module and run standard locate
						return pluginLoader.import(plugin).then(loaderModule => {
							// store the plugin module itself on the metadata
							load.metadata.loaderModule = loaderModule;

							load.address = address;
							if (loaderModule.locate) return loaderModule.locate.call(loader, load);

							return address;
						});
					});
			});
	};
}

function fetch(next) {
	return function $fetch(load) {
		const loader = this;
		if (
			load.metadata.loaderModule &&
			load.metadata.loaderModule.fetch &&
			load.metadata.format !== 'defined'
		) {
			load.metadata.scriptLoad = false;
			return load.metadata.loaderModule.fetch.call(loader, load, loadI => next.call(loader, loadI));
		}
		return next.call(loader, load);
	};
}

function translate(next) {
	return function $translate(load) {
		const loader = this;
		const args = arguments;
		if (
			load.metadata.loaderModule &&
			load.metadata.loaderModule.translate &&
			load.metadata.format !== 'defined'
		) {
			return Promise.resolve(loader::load.metadata.loaderModule.translate(...args)).then(result => {
				const {sourceMap} = load.metadata;

				// sanitize sourceMap if an object not a JSON string
				if (sourceMap) {
					if (typeof sourceMap !== 'object') {
						throw new Error('load.metadata.sourceMap must be set to an object.');
					}

					const originalName = load.address.split('!')[0];

					// force set the filename of the original file
					if (!sourceMap.file || sourceMap.file === load.address) {
						sourceMap.file = `${originalName}!transpiled`;
					}

					// force set the sources list if only one source
					if (
						!sourceMap.sources ||
						sourceMap.sources.length <= 1 &&
						(!sourceMap.sources[0] || sourceMap.sources[0] === load.address)
					) {
						sourceMap.sources = [originalName];
					}
				}

				// if running on file:/// URLs, sourcesContent is necessary
				// load.metadata.sourceMap.sourcesContent = [load.source];

				if (typeof result === 'string') load.source = result;
				else {
					warn.call(this, `Plugin ${load.metadata.loader} should return the source in translate, instead of setting load.source directly. This support will be deprecated.`);
				}

				return next.apply(loader, args);
			});
		}

		return next.apply(loader, args);
	};
}

function instantiate(next) {
	return function $instantiate(load) {
		const loader = this;
		let calledInstantiate = false;

		if (
			load.metadata.loaderModule &&
			load.metadata.loaderModule.instantiate &&
			!loader.builder &&
			load.metadata.format !== 'defined'
		) {
			return Promise.resolve(load.metadata.loaderModule.instantiate.call(loader, load, loadI => {
				if (calledInstantiate) throw new Error('Instantiate must only be called once.');
				calledInstantiate = true;
				return next.call(loader, loadI);
			})).then(result => {
				if (calledInstantiate) return result;
				// TODO: dead code; calledInstantiate is always true

				load.metadata.entry = createEntry();
				load.metadata.entry.execute = () => result;
				load.metadata.entry.deps = load.metadata.deps;
				load.metadata.format = 'defined';
				return next.call(loader, load);
			});
		}

		return next.call(loader, load);
	};
}

export default {
	decanonicalize: createNormalizeSync,
	normalizeSync: createNormalizeSync,
	normalize,
	locate,
	fetch,
	translate,
	instantiate,
};
