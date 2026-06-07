'use strict';

/**
 * TransitionCard: the pict-section-flow node type a transition renders as.
 *
 * In this map a transition is a first-class card sitting between two states (Status -> transition
 * -> Status), not an annotation on an edge. It is styled to read as a connector/gate rather than a
 * lane member: smaller, one muted color, its title showing the entitlement it requires (or "open").
 * It has an input port (the edge from the source state) and an output port (the edge to the target
 * state). Its on-graph panel (double-click) edits the gate fields, calling back into the map view
 * by node hash through AppData.WorkflowMap.ViewID, the same way the StateCard's panel does.
 *
 * The card Code matches Definition-Flow's TRANSITION_NODE_TYPE so a node placed from the palette is
 * the same type the marshaling produces.
 *
 * @author Steven Velozo <steven@velozo.com>
 * @license MIT
 */

const libPictFlowCard = require('pict-section-flow').PictFlowCard;
const libDefinitionFlow = require('../Definition-Flow.js');

class TransitionCard extends libPictFlowCard
{
	constructor(pFable, pOptions, pServiceHash)
	{
		super(pFable, Object.assign(
			{},
			{
				// Title is the type label (the "TRANSITION" eyebrow); the per-node title is the gate.
				Title: 'Transition',
				Name: 'Transition',
				Code: libDefinitionFlow.TRANSITION_NODE_TYPE,
				Description: 'A governed move from one state to the next. Wire it: source state to In, Out to the target state.',
				Category: 'Workflow',
				// Theme-driven muted color so transitions recede against the lane-colored states; white
				// title text (the renderer default) reads on this mid-tone. A pronounced corner radius
				// gives the capsule shape that distinguishes a transition from a state.
				TitleBarColor: 'var(--theme-color-text-secondary, #7f8c8d)',
				BodyStyle: { fill: 'var(--theme-color-background-tertiary, #eef1f4)' },
				Icon: 'WorkflowTransition',
				CornerRadius: 24,
				Width: 160,
				Height: 64,
				ShowTypeLabel: true,
				Inputs:
				[
					{ Name: 'In', Side: 'left' }
				],
				Outputs:
				[
					{ Name: 'Out', Side: 'right' }
				],
				PropertiesPanel:
				{
					PanelType: 'Template',
					DefaultWidth: 300,
					DefaultHeight: 280,
					Title: 'Transition',
					Configuration:
					{
						TemplateHash: 'Workflow-Transition-Panel',
						Templates:
						[
							{
								Hash: 'Workflow-Transition-Panel',
								Template: /*html*/`
<div class="wfp">
	<div class="wfp-transition-head">{~D:Record.Data._FromName~} to {~D:Record.Data._ToName~}</div>
	<div class="wfp-field"><label class="wfp-label">Requires entitlement</label><input type="text" class="wfp-input" list="WFMap-Entitlements" value="{~D:Record.Data.RequiresEntitlement~}" {~D:AppData.WorkflowMap.DisabledAttr~} oninput="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editTransition('{~D:Record.Hash~}','RequiresEntitlement',this.value)"></div>
	<div class="wfp-field"><label class="wfp-label">Actor address</label><input type="text" class="wfp-input" value="{~D:Record.Data.ActorAddress~}" {~D:AppData.WorkflowMap.DisabledAttr~} oninput="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editTransition('{~D:Record.Hash~}','ActorAddress',this.value)"></div>
	<div class="wfp-field"><label class="wfp-label">Guard (JSON, blank for none)</label><textarea class="wfp-input wfp-textarea" {~D:AppData.WorkflowMap.DisabledAttr~} oninput="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editTransitionGuard('{~D:Record.Hash~}',this.value)">{~D:Record.Data._GuardText~}</textarea></div>
</div>`
							}
						]
					}
				}
			},
			pOptions),
			pServiceHash);
	}
}

module.exports = TransitionCard;
