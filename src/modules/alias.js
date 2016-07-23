/*
 * Alias Extension
 *
 * Allows a module to be a plain copy of another module by module name
 *
 * SystemJS.meta['mybootstrapalias'] = { alias: 'bootstrap' };
 *
 */

import {createEntry} from '../utils';

/* eslint-disable no-param-reassign */
const hasOwnProperty = Object.prototype.hasOwnProperty;
function fetch(next) {
	return function $fetch(load) {
		const alias = load.metadata.alias;
		const aliasDeps = load.metadata.deps || [];
		if (alias) {
			load.metadata.format = 'defined';
			const entry = createEntry();
			this.defined[load.name] = entry;
			entry.declarative = true;
			entry.deps = aliasDeps.concat([alias]);
			entry.declare = _export => ({
				setters: [module => {
					for (const p in module) {
						if (hasOwnProperty.call(module, p)) _export(p, module[p]);
					}
					if (module.__useDefault) entry.module.exports.__useDefault = true;
				}],
				execute() {},
			});
			return Promise.resolve('');
		}

		return next.call(this, load);
	};
}

export default {
	fetch,
};
