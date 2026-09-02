const logger = {
	info: (...args) => console.info('[KinoLink Player]', ...args),
	warn: (...args) => console.warn('[KinoLink Player]', ...args),
	error: (...args) => console.error('[KinoLink Player]', ...args),
};

/**
 * Returns a hash code from a string
 * @param {string} str The string to hash
 * @return {string} A 32bit integer as string
 */
function hashCode(str) {
	let hash = 0;
	for (let i = 0, len = str.length; i < len; i++) {
		hash = (hash << 5) - hash + str.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash).toString(36);
}

/**
 * Update URL by setting a search parameter
 * @param {string} key
 * @param {string} value
 */
function setSearchParam(key, value) {
	const url = new URL(location.href);
	url.searchParams.set(key, value);
	history.replaceState(null, '', url.toString());
}

/**
 * Get search parameter from URL
 * @param {string} key
 * @return {string}
 */
function getSearchParam(key) {
	const url = new URL(location.href);
	return url.searchParams.get(key);
}

/**
 * Debounce a function call
 * @param {Function} fn
 * @param {number} delay
 * @return {Function}
 */
function debounce(fn, delay) {
	let timer;
	return (...args) => {
		clearTimeout(timer);
		timer = setTimeout(() => fn(...args), delay);
	};
}