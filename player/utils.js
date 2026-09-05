const logger = {
	info: (...args) => console.info('[KinoLink Player]', ...args),
	warn: (...args) => console.warn('[KinoLink Player]', ...args),
	error: (...args) => console.error('[KinoLink Player]', ...args),
};

function hashCode(str) {
	let hash = 0;
	for (let i = 0, len = str.length; i < len; i++) {
		hash = (hash << 5) - hash + str.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash).toString(36);
}

function getSearchParam(key) {
	const url = new URL(location.href);
	return url.searchParams.get(key);
}
