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

function setSearchParam(key, value) {
	try {
		const url = new URL(location.href);
		url.searchParams.set(key, value);
		history.replaceState(null, '', url.toString());
	} catch (error) {
		logger.warn('Failed to update URL', error);
	}
}

function parseVersionParts(version) {
	return String(version)
		.split('-')[0]
		.split('.')
		.map((part) => parseInt(part, 10) || 0);
}

function compareVersions(a, b) {
	const left = parseVersionParts(a);
	const right = parseVersionParts(b);
	const length = Math.max(left.length, right.length);
	for (let i = 0; i < length; i++) {
		const diff = (left[i] || 0) - (right[i] || 0);
		if (diff !== 0) return diff < 0 ? -1 : 1;
	}
	return 0;
}
