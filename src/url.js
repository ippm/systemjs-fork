// source: https://gist.github.com/Yaffle/1088850

const REPLACE_REGEX = /^\s+|\s+$/g
const MATCH_REGEX = /^([^:\/?#]+:)?(?:\/\/(?:([^:@\/?#]*)(?::([^:@\/?#]*))?@)?(([^:\/?#]*)(?::(\d*))?))?([^?#]*)(\?[^#]*)?(#[\s\S]*)?/;

function URLPony(url, baseURL) {
	const m = String(url).replace(REPLACE_REGEX, '').match(MATCH_REGEX);
	if (!m) throw new RangeError();
	let protocol = m[1] || '';
	let username = m[2] || '';
	let password = m[3] || '';
	let host = m[4] || '';
	let hostname = m[5] || '';
	let port = m[6] || '';
	let pathname = m[7] || '';
	let search = m[8] || '';
	const hash = m[9] || '';
	if (baseURL !== undefined) {
		const base = new URLPony(baseURL);
		const flag = protocol === '' && host === '' && username === '';
		if (flag && pathname === '' && search === '') {
			search = base.search;
		}
		if (flag && pathname.charAt(0) !== '/') {
			if (pathname !== '') {
				pathname = `${(base.host !== '' || base.username !== '') && base.pathname === '' ? '/' : ''}${base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1)}${pathname}`;
			} else pathname = base.pathname;
		}
		// dot segments removal
		const output = [];
		pathname
			.replace(/^(\.\.?(\/|$))+/, '')
			.replace(/\/(\.(\/|$))+/g, '/')
			.replace(/\/\.\.$/, '/../')
			.replace(/\/?[^\/]*/g, p => {
				if (p === '/..') output.pop();
				else output.push(p);
			});
		pathname = output.join('').replace(/^\//, pathname.charAt(0) === '/' ? '/' : '');
		if (flag) {
			port = base.port;
			hostname = base.hostname;
			host = base.host;
			password = base.password;
			username = base.username;
		}
		if (protocol === '') protocol = base.protocol;
	}
	this.origin = `${protocol}${protocol !== '' || host !== '' ? '//' : ''}${host}`;
	this.href = `${protocol}${protocol !== '' || host !== '' ? '//' : ''}${username !== '' ? `${username}${password !== '' ? `:${password}` : ''}@` : ''}${host}${pathname}${search}${hash}`;
	this.protocol = protocol;
	this.username = username;
	this.password = password;
	this.host = host;
	this.hostname = hostname;
	this.port = port;
	this.pathname = pathname;
	this.search = search;
	this.hash = hash;
}

export default typeof URL !== 'undefined' ? URL : URLPony;
