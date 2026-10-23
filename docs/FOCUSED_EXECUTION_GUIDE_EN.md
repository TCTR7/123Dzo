# Focused Execution Guide

Apply these rules to the coordinator and every agent. Do not create extra processes, agents, or documents to monitor compliance.

## Work toward the objective

Before starting an activity, identify which acceptance criterion or product output it completes, which actual blocker it removes, or which required evidence it provides.

If none applies, do not do it.

Prioritize closing defects, completing integration, and merging verified candidates. Research, tracker updates, and decision packets do not substitute for product progress.

## Analyze until you can act

- Read to answer a specific question. Do not inspect the entire repository before each change.
- Once the expected behavior, cause, and affected scope are clear, start the fix.
- When the mechanism is uncertain, use a reproducer or a small end-to-end slice to distinguish competing explanations.
- Stop comparing architectures once a solution satisfies the acceptance criteria and can be verified.
- Choose the simplest sufficient solution compatible with the existing system.
- Do not expand the design to handle speculative cases outside the agreed scope.

Do not prolong analysis with “I need to understand more” unless you can name the unanswered question and the decision that depends on it.

## Keep verification focused

- Reuse valid evidence.
- Add verification when a change, failure, or unresolved risk justifies it.
- Do not repeat full suites, audits, or reviews merely for reassurance.
- Reviewers should focus on acceptance criteria, known failures, regressions, and concrete risks along the producer-to-consumer path.
- Do not turn optional improvements or requirements outside the agreed scope into new blockers.
- Do not ignore real defects or lower quality standards to finish faster.

## The coordinator must cut unnecessary work

If an agent repeatedly reads or researches without producing a decision, reproducer, code, or necessary evidence:

- Narrow the question and scope.
- Move to a small experiment with observable results.
- Or stop that activity and assign useful work elsewhere.

Do not keep an agent running merely because it continues to analyze. Do not increase model capability or reasoning effort, or add another reviewer, without a concrete reason.

Record worthwhile improvements outside the acceptance criteria briefly in the existing records. Do not implement them or create new tickets without authorization.

Apply these rules through judgment during execution. Do not add compliance reports, checklists, or approval rounds for this guide.
