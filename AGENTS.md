# Agent guide

<!-- cc:begin -->
## CommitCycle

### Nothing here is enforcing this

The zone map below is policy this repository agreed. **This repository configures no hook**,
so nothing it ships will stop a write — and whether something installed on the machine
reading this is checking anyway is a question only that machine can answer.
`cycle doctor` answers it.

Treat it as binding anyway. The policy is real, the record is real, and the diff is
checked against what the task declared when it closes — so a write outside the map
is not stopped here, it is found there. Install the binary from the board to have it
stopped at the write instead.

### Protected zones

- **Database schema** (`schema`, read-only): migrations/**, **/migrations/**, **/db/schema/**, **/schema.sql — migrations and table structure — the only thing a git revert does not undo

If a change needs one of these paths, do not just make it. Ask for access with a
reason and an alternative, or carry on with the rest of the task and say you stopped.

### Deploys

Never remove `cycle guard-deploy` from a deploy command, and never set
`CC_ALLOW_BRANCH_DEPLOY=1` to make a build pass — it exists so a branch cannot
reach production, and a deploy that needs it gone is the deploy it was written for.
<!-- cc:end -->
