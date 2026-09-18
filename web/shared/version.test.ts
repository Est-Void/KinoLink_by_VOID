import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION, compareVersions, isOutdated } from './version.ts';

describe('branch version', () => {
	it('is x.y.z-dev', () => {
		assert.match(VERSION, /^\d+\.\d+\.\d+-dev$/);
	});
});

describe('compareVersions', () => {
	it('orders numeric parts', () => {
		assert.equal(compareVersions('2.0.0-dev', '2.0.0-dev'), 0);
		assert.equal(compareVersions('1.9.9', '2.0.0-dev'), -1);
		assert.equal(compareVersions('2.0.1-dev', '2.0.0'), 1);
		assert.equal(compareVersions('2.0', '2.0.0'), 0);
	});

	it('treats -dev as older than the release', () => {
		assert.equal(compareVersions('2.0.0-dev', '2.0.0'), -1);
		assert.equal(compareVersions('2.0.0', '2.0.0-dev'), 1);
	});

	it('never throws on garbage', () => {
		assert.equal(compareVersions('', '2.0.0-dev'), -1);
		assert.equal(compareVersions('lol', 'lol'), 0);
	});
});

describe('isOutdated', () => {
	it('flags older and missing versions', () => {
		assert.equal(isOutdated('1.9.0', VERSION), true);
		assert.equal(isOutdated('', VERSION), true);
		assert.equal(isOutdated(VERSION, VERSION), false);
		assert.equal(isOutdated('2.0.0', VERSION), false);
	});
});
