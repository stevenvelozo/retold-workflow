'use strict';

/**
 * retold-workflow - Board-Model tests
 *
 * The point is the many-to-one rule: several states share a lane, so cards in different states
 * of the same lane sit together with different markers, and the card does not move when the
 * state changes within a lane.
 */

const libAssert = require('node:assert');
const libBoardModel = require('../source/Board-Model.js');

const SOFTWARE =
{
	Key: 'software',
	States:
	[
		{ Key: 'backlog',     Name: 'Backlog',    Lane: 'Backlog' },
		{ Key: 'todo',        Name: 'Ready',      Lane: 'Todo',        Marker: 'ready' },
		{ Key: 'in_progress', Name: 'Coding',     Lane: 'In Progress', Marker: 'coding' },
		{ Key: 'in_ci',       Name: 'CI Running', Lane: 'In Progress', Marker: 'CI running' },
		{ Key: 'in_review',   Name: 'In Review',  Lane: 'Review',      Marker: 'awaiting review' },
		{ Key: 'approved',    Name: 'Approved',   Lane: 'Review',      Marker: 'approved' },
		{ Key: 'blocked',     Name: 'Blocked',    Lane: 'Blocked' },
		{ Key: 'done',        Name: 'Done',       Lane: 'Done' }
	]
};

suite('retold-workflow: Board-Model', () =>
{
	test('lanesOf returns the unique lanes in definition order', () =>
	{
		libAssert.deepStrictEqual(libBoardModel.lanesOf(SOFTWARE), ['Backlog', 'Todo', 'In Progress', 'Review', 'Blocked', 'Done']);
	});

	test('several states share a lane; cards carry their state marker', () =>
	{
		let tmpModel = libBoardModel.buildBoardModel(SOFTWARE,
			[
				{ ID: 'a', State: 'in_progress', Title: 'A' },
				{ ID: 'b', State: 'in_ci', Title: 'B' },
				{ ID: 'c', State: 'in_review' },
				{ ID: 'd', State: 'approved' },
				{ ID: 'e', State: 'backlog' }
			]);

		let tmpInProgress = tmpModel.Lanes.find((pLane) => pLane.Lane === 'In Progress');
		libAssert.strictEqual(tmpInProgress.Cards.length, 2, 'in_progress and in_ci share the In Progress lane');
		libAssert.deepStrictEqual(tmpInProgress.Cards.map((pCard) => pCard.Marker).sort(), ['CI running', 'coding']);
		libAssert.strictEqual(tmpInProgress.Cards.find((pCard) => pCard.SubjectID === 'a').Title, 'A');

		let tmpReview = tmpModel.Lanes.find((pLane) => pLane.Lane === 'Review');
		libAssert.deepStrictEqual(tmpReview.Cards.map((pCard) => pCard.Marker).sort(), ['approved', 'awaiting review']);

		let tmpBacklog = tmpModel.Lanes.find((pLane) => pLane.Lane === 'Backlog');
		libAssert.strictEqual(tmpBacklog.Cards.length, 1);
	});

	test('an unknown state lands in Unassigned', () =>
	{
		let tmpModel = libBoardModel.buildBoardModel(SOFTWARE, [{ ID: 'x', State: 'not-a-state' }]);
		libAssert.strictEqual(tmpModel.Unassigned.length, 1);
		libAssert.strictEqual(tmpModel.Unassigned[0].SubjectID, 'x');
		libAssert.ok(tmpModel.Lanes.every((pLane) => pLane.Cards.length === 0));
	});

	test('empty lanes still appear, in order', () =>
	{
		let tmpModel = libBoardModel.buildBoardModel(SOFTWARE, []);
		libAssert.strictEqual(tmpModel.Lanes.length, 6);
		libAssert.deepStrictEqual(tmpModel.Lanes.map((pLane) => pLane.Lane), ['Backlog', 'Todo', 'In Progress', 'Review', 'Blocked', 'Done']);
	});
});
