'use strict';

/**
 * Board model: group subjects into lanes from a workflow definition.
 *
 * State-to-lane is many-to-one. The lane is the board column a person sees; the state is the
 * finer position. Several states can share a lane, so a card carries the marker of its current
 * state and moving between two states in the same lane changes the marker without moving the
 * card. This computes the data a board view renders; it touches no DOM and no API, so a product
 * can build or test it anywhere.
 *
 * A subject is { ID, State, Title? } where State is the current state key. Lanes come out in the
 * order they first appear across the definition's states. A state with no Lane is its own lane;
 * a subject whose State is unknown to the definition lands in Unassigned.
 */

function lanesOf(pDefinition)
{
	let tmpStates = (pDefinition && pDefinition.States) || [];
	let tmpSeen = {};
	let tmpLanes = [];
	tmpStates.forEach((pState) =>
	{
		let tmpLane = pState.Lane || pState.Key;
		if (!tmpSeen[tmpLane]) { tmpSeen[tmpLane] = true; tmpLanes.push(tmpLane); }
	});
	return tmpLanes;
}

function _indexStates(pDefinition)
{
	let tmpIndex = {};
	((pDefinition && pDefinition.States) || []).forEach((pState) => { tmpIndex[pState.Key] = pState; });
	return tmpIndex;
}

function _card(pSubject, pState)
{
	let tmpCard = {
		SubjectID: pSubject.ID,
		State: pState.Key,
		StateName: pState.Name || pState.Key,
		Marker: pState.Marker || pState.Name || pState.Key
	};
	if (pSubject.Title != null) { tmpCard.Title = pSubject.Title; }
	return tmpCard;
}

function buildBoardModel(pDefinition, pSubjects)
{
	let tmpLanes = lanesOf(pDefinition);
	let tmpStateIndex = _indexStates(pDefinition);
	let tmpLaneByName = {};
	let tmpModel = { Lanes: [], Unassigned: [] };

	tmpLanes.forEach((pLane, pOrder) =>
	{
		let tmpLaneObject = { Lane: pLane, Order: pOrder, Cards: [] };
		tmpLaneByName[pLane] = tmpLaneObject;
		tmpModel.Lanes.push(tmpLaneObject);
	});

	(pSubjects || []).forEach((pSubject) =>
	{
		let tmpState = tmpStateIndex[pSubject.State];
		if (!tmpState) { tmpModel.Unassigned.push({ SubjectID: pSubject.ID, State: pSubject.State || null }); return; }
		let tmpLane = tmpState.Lane || tmpState.Key;
		let tmpLaneObject = tmpLaneByName[tmpLane];
		if (tmpLaneObject) { tmpLaneObject.Cards.push(_card(pSubject, tmpState)); }
		else { tmpModel.Unassigned.push(_card(pSubject, tmpState)); }
	});

	return tmpModel;
}

module.exports = { lanesOf: lanesOf, buildBoardModel: buildBoardModel };
