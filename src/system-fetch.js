import http from 'http';
import https from 'https';
import fs from 'fs';
import {isWindows} from './utils';

/* eslint-disable no-param-reassign */

function fetchTextFromURLXHR(url, authorization, fulfill, reject) {
	let xhr = new XMLHttpRequest();
	let sameDomain = true;
	let doTimeout = false;
	if (!('withCredentials' in xhr)) {
		// check if same domain
		const domainCheck = /^(\w+:)?\/\/([^\/]+)/.exec(url);
		if (domainCheck) {
			sameDomain = domainCheck[2] === window.location.host;
			if (domainCheck[1]) sameDomain &= domainCheck[1] === window.location.protocol;
		}
	}

	function load() {
		fulfill(xhr.responseText);
	}

	function error() {
		const statusText = xhr.statusText ? ` ${xhr.statusText}` : '';
		const status = xhr.status ? ` (${xhr.status}${statusText})` : '';
		reject(new Error(`XHR error${status} loading ${url}`));
	}

	if (!sameDomain && typeof XDomainRequest !== 'undefined') {
		xhr = new XDomainRequest();
		xhr.onload = load;
		xhr.onerror = error;
		xhr.ontimeout = error;
		xhr.onprogress = () => {};
		xhr.timeout = 0;
		doTimeout = true;
	}

	xhr.onreadystatechange = () => {
		if (xhr.readyState === 4) {
			// in Chrome on file:/// URLs, status is 0
			if (xhr.status === 0) {
				if (xhr.responseText) load();
				else {
					// when responseText is empty, wait for load or error event
					// to inform if it is a 404 or empty file
					xhr.addEventListener('error', error);
					xhr.addEventListener('load', load);
				}
			} else if (xhr.status === 200) load();
			else error();
		}
	};
	xhr.open('GET', url, true);

	if (xhr.setRequestHeader) {
		xhr.setRequestHeader('Accept', 'application/x-es-module, */*');
		// can set "authorization: true" to enable withCredentials only
		if (authorization) {
			if (typeof authorization === 'string') xhr.setRequestHeader('Authorization', authorization);
			xhr.withCredentials = true;
		}
	}

	if (doTimeout) setTimeout(() => xhr.send(), 0);
	else xhr.send(null);
}

function fetchTextFromURLNode(url, authorization, fulfill, reject) {
	if (url.substr(0, 7) === 'http://' || url.substr(0, 8) === 'https://') {
		let buf = '';
		const httpModule = url.substr(0, 8) === 'https://' ? https : http;
		const req = httpModule.request(url, res => {
			if (res.statusCode !== 200) {
				reject(new Error(`Unable to fetch "${url}". http status code: ${res.statusCode}`));
			}
			res.setEncoding('utf8');
			res.on('data', chunk => {
				buf += chunk;
			});
			res.on('end', () => fulfill(buf));
		});
		req.on('error', reject);
		req.end();
		return undefined;
	} else if (url.substr(0, 8) !== 'file:///') {
		throw new Error(`Unable to fetch "${url}". Only file URLs of the form file:/// or http[s]:// allowed running in Node.`);
	}

	if (isWindows) url = url.replace(/\//g, '\\').substr(8);
	else url = url.substr(7);
	return fs.readFile(url, (err, data) => {
		if (err) return reject(err);
		// Strip Byte Order Mark out if it's the leading char
		let dataString = String(data);
		if (dataString[0] === '\ufeff') dataString = dataString.substr(1);

		return fulfill(dataString);
	});
}

function fetchTextFromURLFetch(url, authorization, fulfill, reject) {
	const opts = {
		headers: {Accept: 'application/x-es-module, */*'},
	};

	if (authorization) {
		if (typeof authorization === 'string') opts.headers.Authorization = authorization;
		opts.credentials = 'include';
	}

	fetch(url, opts)
		.then(r => {
			if (r.ok) return r.text();
			throw new Error(`Fetch error: ${r.status} ${r.statusText}`);
		})
		.then(fulfill, reject);
}

let fetchTextFromURL;
if (typeof XMLHttpRequest !== 'undefined') {
	fetchTextFromURL = fetchTextFromURLXHR;
} else if (typeof require !== 'undefined' && typeof process !== 'undefined') {
	fetchTextFromURL = fetchTextFromURLNode;
} else if (typeof self !== 'undefined' && typeof self.fetch !== 'undefined') {
	fetchTextFromURL = fetchTextFromURLFetch;
} else {
	throw new TypeError('No environment fetch API available.');
}
export default fetchTextFromURL;
