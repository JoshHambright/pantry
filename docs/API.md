# API reference

Everything is under `/api`. Authentication is a `httpOnly` session cookie set by
`POST /api/auth/login`. Errors are
`{ "error": "<code>", "message": "<human sentence>", "details"?: unknown }`.

**Adult** marks routes that reject `child` members with `403`.

## Health

| Method | Path          | Notes                                                                         |
| ------ | ------------- | ----------------------------------------------------------------------------- |
| GET    | `/api/health` | `{ ok, vision }` — `vision` is whether photo scanning is configured. No auth. |

## Auth

| Method | Path                      | Notes                                                                                           |
| ------ | ------------------------- | ----------------------------------------------------------------------------------------------- |
| GET    | `/auth/members`           | Sign-in picker. Names, roles, colours. No auth, no secrets.                                     |
| POST   | `/auth/bootstrap`         | First run only. Creates the household, starter locations and the first adult. `409` afterwards. |
| POST   | `/auth/login`             | `{ memberId, pin }`. Locks the account for 5 minutes after 8 failures.                          |
| POST   | `/auth/logout`            | Clears this session.                                                                            |
| POST   | `/auth/logout-everywhere` | Clears every session for the signed-in member.                                                  |
| GET    | `/auth/session`           | The signed-in member and their household.                                                       |

## Members · **Adult** to write

| Method | Path           | Notes                                            |
| ------ | -------------- | ------------------------------------------------ |
| GET    | `/members`     |                                                  |
| POST   | `/members`     | `{ name, role, pin, color? }`                    |
| PATCH  | `/members/:id` | Changing a PIN signs that member out everywhere. |
| DELETE | `/members/:id` | Refuses to remove yourself or the last adult.    |

## Locations · **Adult** to write

| Method | Path             | Notes                                                   |
| ------ | ---------------- | ------------------------------------------------------- |
| GET    | `/locations`     |                                                         |
| POST   | `/locations`     | `{ name, kind }` — kind is pantry/fridge/freezer/other. |
| PATCH  | `/locations/:id` |                                                         |
| DELETE | `/locations/:id` | `409` while anything is stored there.                   |

## Products · **Adult** to write

| Method | Path                     | Notes                                                                                               |
| ------ | ------------------------ | --------------------------------------------------------------------------------------------------- |
| GET    | `/products?search=`      |                                                                                                     |
| POST   | `/products`              | Reuses the existing product when the barcode already maps to one.                                   |
| PATCH  | `/products/:id`          |                                                                                                     |
| DELETE | `/products/:id`          | Cascades to its stock.                                                                              |
| GET    | `/products/barcode/:upc` | `{ source: 'known' \| 'openfoodfacts' \| 'miss', product, suggestion }`. A miss is a normal answer. |

## Inventory · **Adult** to write

| Method | Path                                 | Notes                                                                                   |
| ------ | ------------------------------------ | --------------------------------------------------------------------------------------- |
| GET    | `/inventory?search=&includeEmpty=`   | Products with totals, per-lot detail, expiry status and par shortfall.                  |
| POST   | `/inventory`                         | Exactly one of `productId` or an inline `product`.                                      |
| PATCH  | `/inventory/lots/:id`                | Changing `unit` requires a new `quantity`. Reaching zero removes the lot.               |
| DELETE | `/inventory/lots/:id?discarded=true` | `discarded` distinguishes binned from eaten in the event log.                           |
| POST   | `/inventory/consume`                 | `{ productId, quantity, unit }`. Draws oldest-first, returns `{ consumed, shortfall }`. |
| GET    | `/inventory/events?limit=`           | Audit trail.                                                                            |

## Shopping

| Method | Path                      | Notes                                                                                               |
| ------ | ------------------------- | --------------------------------------------------------------------------------------------------- |
| GET    | `/shopping`               |                                                                                                     |
| POST   | `/shopping`               | Anyone. `409` if an open line already covers it.                                                    |
| PATCH  | `/shopping/:id`           | Status is `needed` / `in_cart` / `bought`.                                                          |
| DELETE | `/shopping/:id`           |                                                                                                     |
| POST   | `/shopping/refill`        | **Adult.** Queues everything below its par level.                                                   |
| POST   | `/shopping/checkout`      | **Adult.** Turns bought lines into stock. Free-text lines are ticked off, not invented as products. |
| GET    | `/shopping/suggest?text=` | Products whose name matches a free-text line.                                                       |

## Requests

| Method | Path                    | Notes                                                       |
| ------ | ----------------------- | ----------------------------------------------------------- |
| GET    | `/requests?status=`     |                                                             |
| POST   | `/requests`             | Anyone. `{ kind: 'meal' \| 'grocery', text }`.              |
| POST   | `/requests/:id/respond` | **Adult.** Approving a grocery request adds it to the list. |
| DELETE | `/requests/:id`         | A child may withdraw their own; adults may remove any.      |

## Recipes · **Adult** to write

| Method | Path                                  | Notes                                                                                        |
| ------ | ------------------------------------- | -------------------------------------------------------------------------------------------- |
| GET    | `/recipes`                            |                                                                                              |
| GET    | `/recipes/:id`                        |                                                                                              |
| GET    | `/recipes/availability`               | Every recipe, scored against current stock.                                                  |
| GET    | `/recipes/:id/availability?servings=` | Per-ingredient need / on-hand / shortfall.                                                   |
| POST   | `/recipes`                            | Ingredients may name a `productId` or just a name — names are matched against the catalogue. |
| PATCH  | `/recipes/:id`                        | Ingredients are replaced wholesale when supplied.                                            |
| DELETE | `/recipes/:id`                        |                                                                                              |

## Meal plan · **Adult** to write

| Method | Path                  | Notes                                                                                          |
| ------ | --------------------- | ---------------------------------------------------------------------------------------------- |
| GET    | `/mealplan?from=&to=` | Defaults to the next fortnight.                                                                |
| POST   | `/mealplan`           | Needs a `recipeId` or some `customText`.                                                       |
| PATCH  | `/mealplan/:id`       |                                                                                                |
| DELETE | `/mealplan/:id`       |                                                                                                |
| POST   | `/mealplan/:id/cook`  | Draws ingredients down, adds shortfalls to the list, marks it cooked. `409` if already cooked. |

## Scanning · **Adult**

| Method | Path                               | Notes                                                                                                                             |
| ------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/scan`                            | `multipart/form-data`: up to 5 `photo` files and an optional `hint`. Returns a batch of candidates. Nothing enters the inventory. |
| GET    | `/scan`                            | Recent batches.                                                                                                                   |
| GET    | `/scan/:id`                        | One batch with its candidates.                                                                                                    |
| POST   | `/scan/:id/apply`                  | Confirmed candidates become stock. `409` if already applied.                                                                      |
| DELETE | `/scan/:id`                        |                                                                                                                                   |
| GET    | `/scan/suggest-location?category=` | Where a category most likely belongs.                                                                                             |

## Dashboard

| Method | Path         | Notes                                                                   |
| ------ | ------------ | ----------------------------------------------------------------------- |
| GET    | `/dashboard` | Expired, expiring, low stock, open requests, today's meals, list count. |
