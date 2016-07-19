/*
System bundles

Allows a bundle module to be specified which will be dynamically
loaded before trying to load a given module.

For example:
SystemJS.bundles['mybundle'] = ['jquery', 'bootstrap/js/bootstrap']

Will result in a load to "mybundle" whenever a load to "jquery"
or "bootstrap/js/bootstrap" is made.

In this way, the bundle becomes the request that provides the module
*/

const hasOwnProperty = Object.prototype.hasOwnProperty;

// bundles support (just like RequireJS)
// bundle name is module name of bundle itself
// bundle is array of modules defined by the bundle
// when a module in the bundle is requested, the bundle is loaded instead
// of the form SystemJS.bundles['mybundle'] = ['jquery', 'bootstrap/js/bootstrap']
function constructor(next) {
	return function $constructor() {
		next.call(this);
		this.bundles = {};
		this._loader.loadedBundles = {};
	};
}

// assign bundle metadata for bundle loads
function locate(next) {
	return function $locate(load) {
		let matched = false;

		if (!(load.name in this.defined)) {
			for (const b in this.bundles) {
				if (!this.bundles::hasOwnProperty(b)) continue;

				for (let i = 0; i < this.bundles[b].length; i++) {
					const curModule = this.bundles[b][i];

					if (curModule === load.name) {
						matched = true;
						break;
					}

					// wildcard in bundles does not include / boundaries
					if (curModule.indexOf('*') !== -1) {
						const parts = curModule.split('*');
						if (parts.length !== 2) {
							this.bundles[b].splice(i--, 1);
							continue;
						}

						if (
							load.name.substring(0, parts[0].length) === parts[0] &&
							load.name.substr(load.name.length - parts[1].length, parts[1].length) === parts[1] &&
							load.name.substr(parts[0].length, load.name.length - parts[1].length - parts[0].length).indexOf('/') === -1) {
							matched = true;
							break;
						}
					}
				}

				if (matched) return this.import(b).then(() => next.call(this, load));
			}
		}

		return next.call(this, load);
	};
}

export default {
	constructor,
	locate,
};
