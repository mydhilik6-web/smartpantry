const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function offsetDate(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function uid() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function mockParseGroceryImage(file) {
  await sleep(700);
  console.info("Vision API placeholder received:", {
    name: file.name,
    type: file.type,
    size: file.size,
  });

  return [
    { id: uid(), name: "Scanned Apples", quantity: 6, unit: "pcs", expirationDate: offsetDate(9) },
    { id: uid(), name: "Scanned Kale", quantity: 1, unit: "bunch", expirationDate: offsetDate(2) },
  ];
}

const recipeCatalog = [
  {
    title: "Chicken Tender Parmesan Casserole",
    source: "Allrecipes",
    sourceUrl: "https://www.allrecipes.com/chicken-tender-casserole-recipe-11997429",
    cuisine: "Italian-American",
    tags: ["chicken", "casserole", "high protein", "dinner"],
    ingredients: ["chicken", "spinach", "tomatoes", "pasta", "cheese"],
    macros: { calories: 520, protein: 42, carbs: 38, fat: 22 },
    summary: "A one-pan casserole reference that can use chicken and spinach with pantry sauce or tomatoes.",
    prepNote: "Bake once, portion leftovers for two lunches.",
  },
  {
    title: "Chicken and Rice Casserole Ideas",
    source: "Allrecipes",
    sourceUrl: "https://www.allrecipes.com/best-chicken-and-rice-recipes-11796001",
    cuisine: "American",
    tags: ["chicken", "rice", "meal prep", "comfort food"],
    ingredients: ["chicken", "rice", "broccoli", "cheese", "vegetables"],
    macros: { calories: 610, protein: 39, carbs: 62, fat: 20 },
    summary: "A chicken-and-rice collection for turning protein, rice, and vegetables into one-pot dinners.",
    prepNote: "Cook extra rice and hold half for a second meal.",
  },
  {
    title: "Easy Saag Paneer with Brown Rice",
    source: "EatingWell",
    sourceUrl: "https://www.eatingwell.com/article/290734/7-day-dinner-plan-cook-once-eat-twice/",
    cuisine: "Indian-inspired",
    tags: ["spinach", "rice", "vegetarian", "greens"],
    ingredients: ["spinach", "rice", "paneer", "greens"],
    macros: { calories: 470, protein: 22, carbs: 48, fat: 21 },
    summary: "A spinach-forward dinner idea from a cook-once, eat-twice weekly dinner plan.",
    prepNote: "Use pre-cooked brown rice to make this a fast weeknight meal.",
  },
  {
    title: "Quick Shrimp Fried Rice",
    source: "EatingWell",
    sourceUrl: "https://www.eatingwell.com/article/290734/7-day-dinner-plan-cook-once-eat-twice/",
    cuisine: "Chinese-inspired",
    tags: ["rice", "stir fry", "quick", "seafood"],
    ingredients: ["rice", "vegetables", "shrimp", "eggs"],
    macros: { calories: 430, protein: 28, carbs: 52, fat: 12 },
    summary: "A fast fried-rice option from EatingWell that repurposes leftover brown rice.",
    prepNote: "Batch rice early; reserve vegetables already close to expiration.",
  },
  {
    title: "Southwestern Salad with Black Beans",
    source: "EatingWell",
    sourceUrl: "https://www.eatingwell.com/article/290734/7-day-dinner-plan-cook-once-eat-twice/",
    cuisine: "Southwestern",
    tags: ["salad", "beans", "tomatoes", "vegetarian"],
    ingredients: ["tomatoes", "greens", "beans", "avocado", "lettuce"],
    macros: { calories: 390, protein: 18, carbs: 44, fat: 17 },
    summary: "A dinner salad reference that works well when tomatoes or greens need to be used soon.",
    prepNote: "Prep dressing once and repeat for lunches.",
  },
  {
    title: "Warm Chicken and Kale Salad",
    source: "EatingWell",
    sourceUrl: "https://www.eatingwell.com/article/291205/7-day-whole-food-meal-plan/",
    cuisine: "Mediterranean-inspired",
    tags: ["chicken", "salad", "greens", "high protein"],
    ingredients: ["chicken", "greens", "kale", "spinach"],
    macros: { calories: 410, protein: 36, carbs: 24, fat: 19 },
    summary: "A simple warm salad idea from a whole-food dinner plan, useful for expiring greens.",
    prepNote: "Cook chicken once and serve warm over sturdy greens.",
  },
  {
    title: "Simple 7-Day Healthy Reset Plan",
    source: "EatingWell",
    sourceUrl: "https://www.eatingwell.com/7-day-simple-meal-plan-healthy-reset-11892613",
    cuisine: "Balanced",
    tags: ["weekly plan", "yogurt", "chicken", "balanced"],
    ingredients: ["yogurt", "spinach", "chicken", "rice", "fruit"],
    macros: { calories: 500, protein: 34, carbs: 55, fat: 16 },
    summary: "A dietitian-created 7-day plan reference for balanced weekly structure and meal-prep timing.",
    prepNote: "Use as the weekly scaffold, swapping in pantry-matched dinners.",
  },
];

function normalize(value) {
  return String(value).toLowerCase();
}

function inventoryTerms(inventory, shoppingList = []) {
  return [...inventory, ...shoppingList].flatMap((item) => normalize(item.name).split(/\s+/).filter(Boolean));
}

function expiringTerms(inventory, days = 7) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const max = new Date(now);
  max.setDate(max.getDate() + days);
  return inventory
    .filter((item) => {
      const expires = new Date(`${item.expirationDate}T00:00:00`);
      return expires >= now && expires <= max;
    })
    .flatMap((item) => normalize(item.name).split(/\s+/).filter(Boolean));
}

function recipeText(recipe) {
  return normalize([recipe.title, recipe.cuisine, recipe.source, recipe.summary, ...recipe.tags, ...recipe.ingredients].join(" "));
}

function rankRecipes(inventory, query = "", shoppingList = []) {
  const terms = inventoryTerms(inventory, shoppingList);
  const urgentTerms = expiringTerms(inventory);
  const shoppingTerms = inventoryTerms([], shoppingList);
  const queryTerms = normalize(query).split(/\s+/).filter(Boolean);
  return recipeCatalog
    .map((recipe) => {
      const matchedIngredients = recipe.ingredients.filter((ingredient) =>
        terms.some((term) => normalize(ingredient).includes(term) || term.includes(normalize(ingredient))),
      );
      const expiringMatches = recipe.ingredients.filter((ingredient) =>
        urgentTerms.some((term) => normalize(ingredient).includes(term) || term.includes(normalize(ingredient))),
      );
      const shoppingMatches = recipe.ingredients.filter((ingredient) =>
        shoppingTerms.some((term) => normalize(ingredient).includes(term) || term.includes(normalize(ingredient))),
      );
      const haystack = recipeText(recipe);
      const queryMatches = queryTerms.filter((term) => haystack.includes(term));
      return {
        ...recipe,
        matchedIngredients,
        expiringMatches,
        shoppingMatches,
        queryMatches,
        score: matchedIngredients.length + shoppingMatches.length + expiringMatches.length * 2 + queryMatches.length * 3,
      };
    })
    .filter((recipe) => !queryTerms.length || recipe.queryMatches.length > 0 || recipe.matchedIngredients.length > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

export async function findReferencedRecipes(inventory, query = "", shoppingList = []) {
  await sleep(500);
  return rankRecipes(inventory, query, shoppingList).slice(0, 5);
}

export async function recommendExpiringRecipes(inventory) {
  await sleep(300);
  return rankRecipes(inventory)
    .filter((recipe) => recipe.expiringMatches.length > 0)
    .slice(0, 3);
}

export async function buildWeeklyMealPrepPlan(inventory, shoppingList = []) {
  await sleep(500);
  const ranked = rankRecipes(inventory, "", shoppingList);
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const prepTasks = [
    "Batch cook rice or grains and wash greens.",
    "Use the most urgent greens and open dairy first.",
    "Cook extra protein for tomorrow's lunch.",
    "Repurpose leftover rice or vegetables.",
    "Choose a casserole or one-pan meal for leftovers.",
    "Use any remaining chopped produce.",
    "Keep dinner light and reset the pantry list.",
  ];

  return days.map((day, index) => {
    const recipe = ranked[index % ranked.length];
    return {
      day,
      recipe,
      prepTask: prepTasks[index],
    };
  });
}

export function calculateMacroTotals(plan) {
  return plan.reduce(
    (totals, entry) => {
      const macros = entry.recipe?.macros || {};
      return {
        calories: totals.calories + Number(macros.calories || 0),
        protein: totals.protein + Number(macros.protein || 0),
        carbs: totals.carbs + Number(macros.carbs || 0),
        fat: totals.fat + Number(macros.fat || 0),
      };
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}
