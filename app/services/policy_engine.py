from __future__ import annotations

import re
from typing import Iterable

from app.models.api import PolicyDefinition, PolicyResult


def _rule_matches(rule: str, text: str) -> bool:
    if not rule:
        return False

    try:
        return re.search(rule, text, re.IGNORECASE) is not None
    except re.error:
        # Treat invalid regex as a plain substring match.
        return rule.lower() in text.lower()


def evaluate_policies(
    prompt: str,
    response: str,
    policies: Iterable[PolicyDefinition] | None = None,
) -> list[PolicyResult]:
    combined_text = f"{prompt}\n{response}"
    policy_items = list(policies or [])

    results: list[PolicyResult] = []
    for policy in policy_items:
        matched_rules = [rule for rule in policy.rules if _rule_matches(rule, combined_text)]
        detected = len(matched_rules) > 0
        reason = ", ".join(matched_rules[:3]) if detected else "No rule matched"

        results.append(
            PolicyResult(
                name=policy.name,
                detected=detected,
                action=policy.action,
                reason=reason,
            )
        )

    return results
