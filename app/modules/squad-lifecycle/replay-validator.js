// -*- coding: utf-8 -*-

import { classifySquadNameWithPolicy } from "../../domain/squad-name-policy/index.js";

export function validateReplaySquadCreate(record, config) {
  const normalized = {
    ...record,
    sourceMode: "replay",
    isReplay: true,
    canTriggerActions: false,
  };
  const classified = classifySquadNameWithPolicy(normalized.squadName, config);
  return {
    accepted: classified.evaluation?.valid === true,
    record: normalized,
    evaluation: classified.evaluation,
    classification: classified.classification,
    policyRevision: classified.policyRevision,
  };
}
