# Roadmap

Phases 0–6 are done and the product works. This is what each phase was for, and
where it goes next.

| Phase | Aim                 | Exit criterion                                                         | Status |
| ----- | ------------------- | ---------------------------------------------------------------------- | :----: |
| 0     | Foundation          | The unit and inventory maths are correct and tested in isolation       |   ✅   |
| 1     | Core inventory      | You can sign in and the pantry knows what is in the house              |   ✅   |
| 2     | Scanning            | Groceries get in without typing                                        |   ✅   |
| 3     | Shopping & requests | The list fills itself; kids can ask for things                         |   ✅   |
| 4     | Meals               | The plan is checked against real stock, and cooking draws it down      |   ✅   |
| 5     | Web app             | All of it is usable one-handed on a phone                              |   ✅   |
| 6     | Deployment          | `docker compose up -d` on a Pi, reachable from every family phone      |   ✅   |
| 7     | Living with it      | A month of real use has not surfaced anything that stops it being used |   ⬜   |

## Phase 7 is the real test

Everything up to here was built and verified against a real database, but not
against a real kitchen. The tasks in `TRACKING.md` for phase 7 are guesses at
what will matter. The only one that definitely matters is P7-01: put it on the
hardware, put a week of shopping through it, and let that decide the rest.

Resist adding to phases 0–6. New ideas go to phase 7 or to the cut list.
