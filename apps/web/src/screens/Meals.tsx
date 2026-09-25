import { useCallback, useEffect, useState } from 'react'
import type { MealPlanEntry, MealSlot, Recipe, RecipeAvailability } from '@pantry/shared'
import { MEAL_SLOTS, parseQuantity } from '@pantry/shared'
import { api, ApiRequestError } from '../api.js'
import { Banner, Empty, Field, Segmented, Sheet, Spinner } from '../components/ui.js'
import { addDays, formatDate, todayIso } from '../lib/format.js'

type View = 'week' | 'recipes'

export function Meals({ isAdult }: { isAdult: boolean }) {
  const [view, setView] = useState<View>('week')

  return (
    <>
      <Segmented<View>
        value={view}
        onChange={setView}
        options={[
          { value: 'week', label: 'This week' },
          { value: 'recipes', label: 'Recipes' },
        ]}
      />
      <div style={{ height: 14 }} />
      {view === 'week' ? <WeekPlan isAdult={isAdult} /> : <RecipeList isAdult={isAdult} />}
    </>
  )
}

function WeekPlan({ isAdult }: { isAdult: boolean }) {
  const today = todayIso()
  const [entries, setEntries] = useState<MealPlanEntry[] | null>(null)
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [adding, setAdding] = useState<{ date: string } | null>(null)
  const [reload, setReload] = useState(0)

  const from = today
  const to = addDays(today, 6)

  useEffect(() => {
    api.mealplan
      .range(from, to)
      .then((result) => setEntries(result.entries))
      .catch(() => setError('Could not load the plan'))
    void api.recipes.list().then((result) => setRecipes(result.recipes))
  }, [from, to, reload])

  const refresh = useCallback(() => setReload((current) => current + 1), [])

  const cook = async (entry: MealPlanEntry) => {
    setNote(null)
    try {
      const result = await api.mealplan.cook(entry.id, { addShortfallToList: true })
      setNote(
        result.short.length === 0
          ? `Took ${result.used.length} ingredient(s) out for ${result.recipe}.`
          : `Cooked ${result.recipe}. Short on ${result.short
              .map((item) => item.name)
              .join(', ')} — added to the shopping list.`,
      )
      refresh()
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Could not cook that')
    }
  }

  if (error && !entries) return <Banner kind="error">{error}</Banner>
  if (!entries) return <Spinner />

  const days = Array.from({ length: 7 }, (_, offset) => addDays(today, offset))

  return (
    <>
      {error ? <Banner kind="error">{error}</Banner> : null}
      {note ? <Banner kind="info">{note}</Banner> : null}

      <div className="week">
        {days.map((date) => {
          const forDay = entries.filter((entry) => entry.date === date)
          return (
            <div key={date} className={`card ${date === today ? 'day--today' : ''}`}>
              <div className="card__head">
                <span className="day__date">{date === today ? 'Today' : formatDate(date)}</span>
                {isAdult ? (
                  <button className="btn btn--ghost btn--sm" onClick={() => setAdding({ date })}>
                    + Add
                  </button>
                ) : null}
              </div>

              {forDay.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  Nothing planned
                </p>
              ) : (
                <ul className="list">
                  {forDay.map((entry) => (
                    <li key={entry.id} className="item item--flat">
                      <span className="grow truncate">
                        <span className="item__title">{entry.recipeName ?? entry.customText}</span>
                        <div className="muted">{entry.slot}</div>
                      </span>
                      {entry.cookedAt ? (
                        <span className="chip chip--ok">Cooked</span>
                      ) : isAdult && entry.recipeId ? (
                        <button className="btn btn--sm" onClick={() => void cook(entry)}>
                          Cook
                        </button>
                      ) : null}
                      {isAdult ? (
                        <button
                          className="btn btn--ghost btn--sm"
                          aria-label="Remove from plan"
                          onClick={() => void api.mealplan.remove(entry.id).then(refresh)}
                        >
                          &#10005;
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      {adding ? (
        <AddMealSheet
          date={adding.date}
          recipes={recipes}
          onClose={() => setAdding(null)}
          onAdded={() => {
            setAdding(null)
            refresh()
          }}
        />
      ) : null}
    </>
  )
}

function AddMealSheet({
  date,
  recipes,
  onClose,
  onAdded,
}: {
  date: string
  recipes: Recipe[]
  onClose: () => void
  onAdded: () => void
}) {
  const [slot, setSlot] = useState<MealSlot>('dinner')
  const [recipeId, setRecipeId] = useState('')
  const [customText, setCustomText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.mealplan.add({
        date,
        slot,
        ...(recipeId ? { recipeId } : { customText: customText.trim() }),
      })
      onAdded()
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Could not add that')
      setBusy(false)
    }
  }

  return (
    <Sheet title={`Plan ${formatDate(date)}`} onClose={onClose}>
      {error ? <Banner kind="error">{error}</Banner> : null}
      <div className="stack">
        <Field label="Which meal">
          <select value={slot} onChange={(event) => setSlot(event.target.value as MealSlot)}>
            {MEAL_SLOTS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>

        <Field label="A recipe" hint="Or leave it blank and just write what you're having.">
          <select value={recipeId} onChange={(event) => setRecipeId(event.target.value)}>
            <option value="">&mdash; none &mdash;</option>
            {recipes.map((recipe) => (
              <option key={recipe.id} value={recipe.id}>
                {recipe.name}
              </option>
            ))}
          </select>
        </Field>

        {recipeId === '' ? (
          <Field label="What are we having?">
            <input
              value={customText}
              onChange={(event) => setCustomText(event.target.value)}
              placeholder="Leftovers"
            />
          </Field>
        ) : null}

        <button
          className="btn btn--primary btn--lg btn--block"
          onClick={() => void submit()}
          disabled={busy || (!recipeId && !customText.trim())}
        >
          Add to the plan
        </button>
      </div>
    </Sheet>
  )
}

function RecipeList({ isAdult }: { isAdult: boolean }) {
  const [recipes, setRecipes] = useState<Recipe[] | null>(null)
  const [availability, setAvailability] = useState<Record<string, RecipeAvailability>>({})
  const [open, setOpen] = useState<Recipe | null>(null)
  const [creating, setCreating] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    void api.recipes.list().then((result) => setRecipes(result.recipes))
    void api.recipes
      .availability()
      .then((result) =>
        setAvailability(
          Object.fromEntries(result.availability.map((entry) => [entry.recipeId, entry])),
        ),
      )
  }, [reload])

  if (!recipes) return <Spinner />

  return (
    <>
      {isAdult ? (
        <button
          className="btn btn--block"
          style={{ marginBottom: 12 }}
          onClick={() => setCreating(true)}
        >
          + New recipe
        </button>
      ) : null}

      {recipes.length === 0 ? (
        <Empty
          icon={'\u{1F4D6}'}
          title="No recipes yet"
          hint="Add one and the pantry will tell you whether you can make it."
        />
      ) : (
        <ul className="list">
          {recipes.map((recipe) => {
            const status = availability[recipe.id]
            return (
              <li key={recipe.id}>
                <button type="button" className="item" onClick={() => setOpen(recipe)}>
                  <span className="grow truncate">
                    <span className="item__title">{recipe.name}</span>
                    <div className="muted">
                      Serves {recipe.servings} &middot; {recipe.ingredients.length} ingredients
                    </div>
                  </span>
                  {status ? (
                    status.canCook ? (
                      <span className="chip chip--ok">Can make</span>
                    ) : (
                      <span className="chip chip--warn">{status.missingCount} short</span>
                    )
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {open ? (
        <RecipeSheet
          recipe={open}
          availability={availability[open.id]}
          isAdult={isAdult}
          onClose={() => setOpen(null)}
          onDeleted={() => {
            setOpen(null)
            setReload((current) => current + 1)
          }}
        />
      ) : null}

      {creating ? (
        <NewRecipeSheet
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            setReload((current) => current + 1)
          }}
        />
      ) : null}
    </>
  )
}

function RecipeSheet({
  recipe,
  availability,
  isAdult,
  onClose,
  onDeleted,
}: {
  recipe: Recipe
  availability: RecipeAvailability | undefined
  isAdult: boolean
  onClose: () => void
  onDeleted: () => void
}) {
  return (
    <Sheet title={recipe.name} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        Serves {recipe.servings}
      </p>

      <h3 style={{ marginBottom: 8 }}>Ingredients</h3>
      <ul className="list">
        {recipe.ingredients.map((ingredient) => {
          const status = availability?.ingredients.find(
            (entry) => entry.ingredientId === ingredient.id,
          )
          return (
            <li key={ingredient.id} className="item item--flat">
              <span className="grow truncate">
                <span className="item__title">{ingredient.name}</span>
                <div className="muted">
                  {ingredient.quantity} {ingredient.unit}
                  {ingredient.optional ? ' · optional' : ''}
                </div>
              </span>
              {status ? (
                status.shortfall > 0 ? (
                  <span className={`chip chip--${ingredient.optional ? 'warn' : 'danger'}`}>
                    short {status.shortfall} {status.unit}
                  </span>
                ) : (
                  <span className="chip chip--ok">have it</span>
                )
              ) : null}
            </li>
          )
        })}
      </ul>

      {recipe.instructions ? (
        <>
          <h3 style={{ margin: '18px 0 8px' }}>Method</h3>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{recipe.instructions}</p>
        </>
      ) : null}

      {isAdult ? (
        <button
          className="btn btn--danger btn--block"
          style={{ marginTop: 18 }}
          onClick={() => void api.recipes.remove(recipe.id).then(onDeleted)}
        >
          Delete recipe
        </button>
      ) : null}
    </Sheet>
  )
}

/** Ingredients are typed as free text and parsed — "2 lbs chicken" just works. */
function NewRecipeSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [servings, setServings] = useState(4)
  const [lines, setLines] = useState('')
  const [instructions, setInstructions] = useState('')
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const [importing, setImporting] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Importing fills the form rather than saving. The ingredient lines come back
   * exactly as the site wrote them, so what gets parsed is what you can see and
   * edit — same rule as a photo scan: a machine proposes, a person decides.
   */
  const importFromLink = async () => {
    setImporting(true)
    setError(null)
    setNote(null)
    try {
      const draft = await api.recipes.import(link.trim())
      setName(draft.name)
      setServings(draft.servings)
      setInstructions(draft.instructions ?? '')
      setLines(draft.ingredients.map((ingredient) => ingredient.raw).join('\n'))
      setSourceUrl(draft.sourceUrl)
      setNote(`Read ${draft.ingredients.length} ingredient(s). Check them over before saving.`)
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Could not read that page')
    } finally {
      setImporting(false)
    }
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const ingredients = lines
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .map((line) => {
          const parsed = parseQuantity(line)
          return {
            name: parsed?.remainder || line,
            quantity: parsed?.quantity ?? 1,
            unit: parsed?.unit ?? 'each',
          }
        })

      await api.recipes.create({
        name,
        servings,
        ingredients,
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
      })
      onCreated()
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Could not save that')
      setBusy(false)
    }
  }

  return (
    <Sheet title="New recipe" onClose={onClose}>
      {error ? <Banner kind="error">{error}</Banner> : null}
      {note ? <Banner kind="info">{note}</Banner> : null}

      <Field label="Import from a link" hint="Most recipe sites work. Nothing saves until you do.">
        <div className="row">
          <input
            className="grow"
            type="url"
            inputMode="url"
            value={link}
            placeholder="https://example.com/a-recipe"
            onChange={(event) => setLink(event.target.value)}
          />
          <button
            type="button"
            className="btn"
            disabled={importing || link.trim() === ''}
            onClick={() => void importFromLink()}
          >
            {importing ? 'Reading…' : 'Read'}
          </button>
        </div>
      </Field>

      <div className="stack" style={{ marginTop: 14 }}>
        <Field label="Name">
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
        <Field label="Serves">
          <input
            type="number"
            min={1}
            max={50}
            value={servings}
            onChange={(event) => setServings(Number.parseInt(event.target.value, 10) || 1)}
          />
        </Field>
        <Field
          label="Ingredients"
          hint="One per line, the way you'd write them: 2 lbs chicken thighs"
        >
          <textarea
            rows={6}
            value={lines}
            onChange={(event) => setLines(event.target.value)}
            placeholder={'500 g pasta\n2 cups tomato sauce\n1 onion'}
          />
        </Field>
        <Field label="Method">
          <textarea
            rows={4}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </Field>
        <button
          className="btn btn--primary btn--lg btn--block"
          onClick={() => void submit()}
          disabled={busy || !name.trim()}
        >
          Save recipe
        </button>
      </div>
    </Sheet>
  )
}
