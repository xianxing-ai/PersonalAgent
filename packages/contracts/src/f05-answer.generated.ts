// Generated from schema/f05-answer.json. Do not edit.

export interface F05AnswerCandidate {
  version: 1;
  answer: string;
  /**
   * @maxItems 16
   */
  claims: {
    id: string;
    text: string;
    /**
     * @minItems 1
     * @maxItems 8
     */
    citations: {
      sourceId: string;
      quote: string;
    }[];
  }[];
  /**
   * @maxItems 16
   */
  unresolved: string[];
}
