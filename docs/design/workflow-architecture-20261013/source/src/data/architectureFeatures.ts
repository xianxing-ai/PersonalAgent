import data from './architecture.json';
import {FEATURE_NOTE_REVISIONS} from './currentNotes';
export interface ArchitectureNode {
 id:string;label:string;kind:string;dependencies:string[];required:boolean;resourceKeys:string[];effectType:string;
 inputFields:string[];outputFields:string[];modelAssignment?:{vendor:string;model:string;role:string;thinkingLevel?:string};
 evidenceRequirement?:string;failureRoute?:string;condition?:string;joinMode?:'all'|'selected'|'any';
}
export interface ArchitectureEdge {id:string;source:string;target:string;required:boolean;branchLabel?:string;condition?:string}
export interface ArchitectureFeature {id:string;code:string;name:string;category:string;summary:string;decisionPoints:string[];nodes:ArchitectureNode[];edges:ArchitectureEdge[];recovery:string[];designNotes?:string[];acceptance?:string[]}
// Display notes may clarify current scope; never mutate the raw production
// catalog, node/model metadata, graph structure or template identity here.
export const ALL_FEATURES = (data as ArchitectureFeature[]).map(feature=>({
 ...feature,
 designNotes:feature.designNotes?.map(note=>FEATURE_NOTE_REVISIONS[note]??note),
}));
