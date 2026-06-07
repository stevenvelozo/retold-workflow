'use strict';

/**
 * retold-workflow - Metrics-Format tests
 *
 * Compact durations (the two largest units) and a rollup turned into display rows, sorted so the
 * state a subject spent the most time in is first.
 */

const libAssert = require('node:assert');
const libMetricsFormat = require('../source/Metrics-Format.js');

suite('retold-workflow: Metrics-Format', () =>
{
	suite('formatDuration', () =>
	{
		test('the two largest non-zero units', () =>
		{
			libAssert.strictEqual(libMetricsFormat.formatDuration(8000), '8s');
			libAssert.strictEqual(libMetricsFormat.formatDuration(252000), '4m 12s');
			libAssert.strictEqual(libMetricsFormat.formatDuration((4 * 3600 + 12 * 60) * 1000), '4h 12m');
			libAssert.strictEqual(libMetricsFormat.formatDuration((26 * 3600) * 1000), '1d 2h');
		});

		test('zero, negative, and non-finite read 0s', () =>
		{
			libAssert.strictEqual(libMetricsFormat.formatDuration(0), '0s');
			libAssert.strictEqual(libMetricsFormat.formatDuration(-5), '0s');
			libAssert.strictEqual(libMetricsFormat.formatDuration(null), '0s');
			libAssert.strictEqual(libMetricsFormat.formatDuration(undefined), '0s');
		});

		test('a span under a second reads 0s', () =>
		{
			libAssert.strictEqual(libMetricsFormat.formatDuration(750), '0s');
		});
	});

	suite('summarizeMetrics', () =>
	{
		const ROLLUP =
		{
			OpenedAt: 1000, ClosedAt: 100000,
			ElapsedMS: 99000, ActiveMS: 60000, StalledMS: 39000, EffortMS: 72000, OverlapMS: 12000,
			StateTime: { backlog: 5000, in_progress: 80000, in_review: 14000 },
			ActorTime: { 'user-1': 72000 }
		};

		test('the headline figures come out in order, formatted', () =>
		{
			let tmpSummary = libMetricsFormat.summarizeMetrics(ROLLUP);
			libAssert.deepStrictEqual(tmpSummary.Figures.map((pFigure) => pFigure.Label), ['Elapsed', 'Active', 'Stalled', 'Effort', 'Overlap']);
			let tmpElapsed = tmpSummary.Figures.find((pFigure) => pFigure.Key === 'ElapsedMS');
			libAssert.strictEqual(tmpElapsed.Value, '1m 39s');
			libAssert.strictEqual(tmpElapsed.RawMS, 99000);
		});

		test('state time is sorted longest first and names are resolved', () =>
		{
			let tmpSummary = libMetricsFormat.summarizeMetrics(ROLLUP, { in_progress: 'Coding', backlog: 'Backlog', in_review: 'In Review' });
			libAssert.deepStrictEqual(tmpSummary.StateTime.map((pRow) => pRow.State), ['Coding', 'In Review', 'Backlog']);
			libAssert.strictEqual(tmpSummary.StateTime[0].Value, '1m 20s');
			libAssert.strictEqual(tmpSummary.Closed, true);
		});

		test('a null rollup yields empty rows, not a crash', () =>
		{
			let tmpSummary = libMetricsFormat.summarizeMetrics(null);
			libAssert.deepStrictEqual(tmpSummary.StateTime, []);
			libAssert.strictEqual(tmpSummary.Closed, false);
			libAssert.strictEqual(tmpSummary.Figures.length, 5);
			libAssert.strictEqual(tmpSummary.Figures[0].Value, '0s');
		});
	});
});
