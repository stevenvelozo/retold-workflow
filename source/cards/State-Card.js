'use strict';

/**
 * StateCard: the pict-section-flow node type a workflow state renders as.
 *
 * One card type serves every state; the lane color is set per node by the marshaling (so all
 * lanes share this one card, colored individually), not baked into the card. The card carries
 * an input port for incoming transitions and an output port for outgoing ones, which is what
 * definitionToFlow wires connections between. Editing a state's fields (Name, Lane, Marker,
 * IsInitial, IsTerminal) and a transition's fields is done by the map view's own inspector, so
 * the card declares no on-graph properties panel.
 *
 * The card Code matches Definition-Flow's STATE_NODE_TYPE so a node placed from the palette is
 * the same type the marshaling produces.
 *
 * @author Steven Velozo <steven@velozo.com>
 * @license MIT
 */

const libPictFlowCard = require('pict-section-flow').PictFlowCard;
const libDefinitionFlow = require('../Definition-Flow.js');

class StateCard extends libPictFlowCard
{
	constructor(pFable, pOptions, pServiceHash)
	{
		super(pFable, Object.assign(
			{},
			{
				Title: 'State',
				Name: 'Workflow State',
				Code: libDefinitionFlow.STATE_NODE_TYPE,
				Description: 'A state in the workflow. Incoming transitions arrive at In; outgoing transitions leave from Out.',
				Category: 'Workflow',
				TitleBarColor: '#3d6fb4',
				Width: 190,
				Height: 70,
				Inputs:
				[
					{ Name: 'In', Side: 'left' }
				],
				Outputs:
				[
					{ Name: 'Out', Side: 'right' }
				]
			},
			pOptions),
			pServiceHash);
	}
}

module.exports = StateCard;
