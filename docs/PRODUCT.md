# Pantry — what this is

A grocery inventory and meal planner for one household, running on hardware the
household owns.

Two adults run it. Two kids can ask for things. Nobody is going to maintain it
as a hobby, so it has to be worth opening on a Tuesday evening with a bag of
shopping in one hand.

---

## The loop it has to close

1. **Groceries come in.** Scan a barcode, or photograph the counter. Confirm.
2. **The pantry knows what is there.** Quantities, locations, expiry dates.
3. **Meals get planned** against what is actually in the house.
4. **Cooking draws it down.** Whatever you were short of lands on the list.
5. **The list drives the next shop.** Low items add themselves. Kids' approved
   requests add themselves.
6. Back to 1.

Every feature either closes that loop or is out of scope.

---

## Design principles

**It has to be faster than not using it.** The moment maintaining the inventory
costs more than the inventory is worth, it gets abandoned and the data rots.
Scanning is one tap. Adding a whole shop is one photo and one confirmation.

**Never silently guess.** A wrong number in an inventory is worse than a missing
one, because a wrong number is trusted. The app reports "2 cans and 500 g" as
two totals rather than inventing a conversion, and a model's reading of a photo
is a proposal until a person agrees with it.

**Answer in the user's units.** Someone who buys milk by the gallon is told they
have half a gallon. Correct-but-metric is a bug.

**Phone first.** It is used standing up, one-handed, in a kitchen. Large targets,
bottom navigation, no hover-dependent anything.

**Degrade, don't break.** No API key means no photo scanning and nothing else
changes. No network means barcodes already seen still resolve.

---

## Who can do what

|                                    | Adult | Child |
| ---------------------------------- | :---: | :---: |
| See the pantry and the plan        |  ✅   |  ✅   |
| Add / edit / use stock             |  ✅   |   —   |
| Scan                               |  ✅   |   —   |
| Add to the shopping list           |  ✅   |  ✅   |
| Check items off, put shopping away |  ✅   |   —   |
| Ask for a meal or an item          |  ✅   |  ✅   |
| Answer a request                   |  ✅   |   —   |
| Withdraw their own request         |  ✅   |  ✅   |
| Recipes and the meal plan          |  ✅   |   —   |
| Manage people and places           |  ✅   |   —   |

---

## Deliberately not in scope

- **Nutrition tracking and calorie counting.** A different app for a different
  purpose. Open Food Facts returns the data; we do not store or show it.
- **Price tracking and budgeting.** Would need receipt parsing and per-store
  pricing to be worth anything. Large, and not part of the loop above.
- **Multi-household / sharing.** Everything is scoped to a household because it
  costs one column, but there is no invite flow and no intention of one.
- **A native app.** An installable PWA gets the camera, the home screen icon and
  offline shell. A native app would add two build pipelines for nothing.
- **Automatic depletion.** No guessing that milk ran out because a week passed.
  The inventory says what someone told it.
- **Public internet exposure.** It is designed for a LAN or a tailnet. PIN
  sign-in is only defensible on that assumption (see `DECISIONS.md` D-004).

---

## Platform constraints already settled

- **The camera needs a secure context.** `getUserMedia` is unavailable on plain
  HTTP outside `localhost`. Tailscale or a reverse proxy is not optional if you
  want to scan from a phone. `DEPLOY.md` covers it.
- **Safari has no `BarcodeDetector`.** ZXing loads lazily on those devices only.
- **Open Food Facts is community data.** Store brands are frequently missing and
  a miss is a normal outcome, not an error.
- **Photo scanning costs money per scan.** It is one API call per photo. This is
  why it is a deliberate button and not something that runs on its own.
