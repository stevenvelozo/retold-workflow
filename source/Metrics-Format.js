'use strict';

/**
 * Metrics formatting for the subject-detail view: raw millisecond figures from the engine's
 * folded rollup turned into short readable strings and a flat list of display rows. Pure, so it
 * is testable on its own and carries no opinion about how the view paints them.
 *
 * The engine rollup is { OpenedAt, ClosedAt, ElapsedMS, ActiveMS, StalledMS, EffortMS,
 * OverlapMS, StateTime: { stateKey: ms }, ActorTime: { actorId: ms } }. formatDuration turns a
 * span into "2d 3h" / "4h 12m" / "45s"; summarizeMetrics turns the whole rollup into the figures
 * and the per-state breakdown a view iterates over.
 *
 * @author Steven Velozo <steven@velozo.com>
 * @license MIT
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A compact human duration: the two largest non-zero units, e.g. 90061000 -> "1d 1h",
 * 252000 -> "4m 12s", 8000 -> "8s". A span under a second reads "0s". Negative or non-finite
 * input reads "0s" too, so a partial rollup never prints garbage.
 */
function formatDuration(pMilliseconds)
{
	let tmpMS = Number(pMilliseconds);
	if (!isFinite(tmpMS) || tmpMS <= 0) { return '0s'; }

	let tmpParts = [];
	let tmpDays = Math.floor(tmpMS / DAY); tmpMS -= tmpDays * DAY;
	let tmpHours = Math.floor(tmpMS / HOUR); tmpMS -= tmpHours * HOUR;
	let tmpMinutes = Math.floor(tmpMS / MINUTE); tmpMS -= tmpMinutes * MINUTE;
	let tmpSeconds = Math.floor(tmpMS / SECOND);

	if (tmpDays) { tmpParts.push(tmpDays + 'd'); }
	if (tmpHours) { tmpParts.push(tmpHours + 'h'); }
	if (tmpMinutes) { tmpParts.push(tmpMinutes + 'm'); }
	if (tmpSeconds) { tmpParts.push(tmpSeconds + 's'); }

	if (!tmpParts.length) { return '0s'; }
	return tmpParts.slice(0, 2).join(' ');
}

// The headline figures, in display order. Each maps a rollup field to a label.
const _FIGURES =
[
	{ Key: 'ElapsedMS', Label: 'Elapsed' },
	{ Key: 'ActiveMS', Label: 'Active' },
	{ Key: 'StalledMS', Label: 'Stalled' },
	{ Key: 'EffortMS', Label: 'Effort' },
	{ Key: 'OverlapMS', Label: 'Overlap' }
];

/**
 * Turn a rollup into display rows. Returns:
 *   { Figures: [{ Key, Label, Value, RawMS }],
 *     StateTime: [{ State, Value, RawMS }] sorted longest first,
 *     Closed: boolean }
 * A null/empty rollup yields empty arrays so a view can show "no metrics yet" cleanly. The
 * optional pStateNames maps a state key to a display name for the breakdown rows.
 */
function summarizeMetrics(pMetrics, pStateNames)
{
	let tmpMetrics = pMetrics || {};
	let tmpStateNames = pStateNames || {};

	let tmpFigures = _FIGURES.map((pFigure) =>
	{
		let tmpRaw = Number(tmpMetrics[pFigure.Key]) || 0;
		return { Key: pFigure.Key, Label: pFigure.Label, Value: formatDuration(tmpRaw), RawMS: tmpRaw };
	});

	let tmpStateRollup = tmpMetrics.StateTime || {};
	let tmpStateTime = Object.keys(tmpStateRollup).map((pStateKey) =>
	{
		let tmpRaw = Number(tmpStateRollup[pStateKey]) || 0;
		return { State: tmpStateNames[pStateKey] || pStateKey, StateKey: pStateKey, Value: formatDuration(tmpRaw), RawMS: tmpRaw };
	});
	tmpStateTime.sort((pA, pB) => pB.RawMS - pA.RawMS);

	return { Figures: tmpFigures, StateTime: tmpStateTime, Closed: !!tmpMetrics.ClosedAt };
}

module.exports =
{
	formatDuration: formatDuration,
	summarizeMetrics: summarizeMetrics
};
