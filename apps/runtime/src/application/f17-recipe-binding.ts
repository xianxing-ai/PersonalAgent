import type {WorkspaceCommandRecipe} from '@personal-agent/coding-tools';

/** Main's existing command host owns the executable. Its public configuration binding
 * pins the fixed recipe without exposing or reconstructing executable arguments. */
export type F17RecipeBinding=WorkspaceCommandRecipe|{id:string;configurationRef:string};
