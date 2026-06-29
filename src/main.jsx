import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bot,
  CalendarDays,
  Camera,
  Check,
  Edit3,
  ExternalLink,
  Gauge,
  ListChecks,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  ShoppingCart,
  Trash2,
  Warehouse,
  X,
} from "lucide-react";
import "./styles.css";
import {
  decodeBarcodeFromImage,
  deleteInventoryItem,
  deleteShoppingListItem,
  loadDailyLog,
  loadInventory,
  loadSavedMealPlan,
  loadSavedShoppingList,
  lookupBarcode,
  offsetDate,
  saveDailyLog,
  saveInventoryItem,
  saveMealPlan,
  saveShoppingList,
  seedInventory,
  uid,
} from "./api";
import { buildWeeklyMealPrepPlan, findReferencedRecipes, recommendExpiringRecipes } from "./mockBackend";

const LOW_QUANTITY_THRESHOLD = 0;
const STORAGE_ZONES = ["fridge", "freezer", "pantry", "seasonings"];
const WEEK_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"];
const STORAGE_ZONE_LABELS = {
  fridge: "Fridge",
  freezer: "Freezer",
  pantry: "Pantry",
  seasonings: "Seasonings",
};

const MEAL_TYPE_LABELS = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

function getItemStatus(item) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expires = new Date(`${item.expirationDate}T00:00:00`);
  const hoursUntilExpiry = (expires.getTime() - today.getTime()) / 36e5;
  const expired = hoursUntilExpiry < 0;
  const urgent = !expired && hoursUntilExpiry <= 48;
  const zeroItem = item.unit?.trim().toLowerCase() === "item" && Number(item.quantity) === 0;
  const low = Number(item.quantity) <= LOW_QUANTITY_THRESHOLD;
  return { expired, urgent, low, zeroItem, hoursUntilExpiry };
}

function formatDate(dateString) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(`${dateString}T00:00:00`));
}

function inferStorageZone(item) {
  const name = `${item.name || ""} ${item.unit || ""}`.toLowerCase();
  const seasoningWords = [
    "spice",
    "seasoning",
    "salt",
    "pepper",
    "cumin",
    "coriander",
    "paprika",
    "turmeric",
    "cinnamon",
    "rosemary",
    "basil",
    "masala",
    "cardamom",
    "bouillon",
    "powder",
    "extract",
    "leaves",
    "chili powder",
    "chilli powder",
    "onion powder",
    "garlic powder",
    "pumpkin pie",
    "clasico",
    "kashmiri",
  ];
  const freezerWords = ["frozen", "ice cream", "freezer"];
  const fridgeWords = ["milk", "yogurt", "cheese", "butter", "cream", "sour cream", "eggs", "turkey", "chicken breast", "pepper jack", "babybel", "cream cheese", "strawberry", "kiwi", "green onion", "cabbage"];
  if (seasoningWords.some((word) => name.includes(word))) return "seasonings";
  if (freezerWords.some((word) => name.includes(word))) return "freezer";
  if (fridgeWords.some((word) => name.includes(word))) return "fridge";
  return "pantry";
}

function normalizeStorageZone(item) {
  const inferred = inferStorageZone(item);
  if (inferred === "seasonings") return "seasonings";
  return STORAGE_ZONES.includes(item.category) ? item.category : inferStorageZone(item);
}

function macroValue(macros, key) {
  return Number(macros?.[key] || 0);
}

function emptyMeal(name = "") {
  return {
    id: uid(),
    name,
    source: "",
    sourceUrl: "",
    ingredients: [],
    macros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    notes: "",
  };
}

function emptyWeekPlan() {
  return WEEK_DAYS.map((day) => ({
    day,
    prepTask: "",
    meals: {
      breakfast: emptyMeal(""),
      lunch: emptyMeal(""),
      dinner: emptyMeal(""),
      snack: emptyMeal(""),
    },
  }));
}

function isMealEntered(meal) {
  return Boolean(
    String(meal?.name || "").trim() ||
      String(meal?.notes || "").trim() ||
      String(meal?.sourceUrl || "").trim() ||
      macroValue(meal?.macros, "calories") ||
      macroValue(meal?.macros, "protein") ||
      macroValue(meal?.macros, "carbs") ||
      macroValue(meal?.macros, "fat"),
  );
}

function recipeToMeal(recipe, fallbackName = "") {
  if (!recipe) return emptyMeal(fallbackName);
  return {
    id: uid(),
    name: recipe.title || fallbackName,
    source: recipe.source || "",
    sourceUrl: recipe.sourceUrl || "",
    ingredients: recipe.ingredients || [],
    macros: {
      calories: macroValue(recipe.macros, "calories"),
      protein: macroValue(recipe.macros, "protein"),
      carbs: macroValue(recipe.macros, "carbs"),
      fat: macroValue(recipe.macros, "fat"),
    },
    notes: recipe.prepNote || "",
  };
}

function createEditableWeekPlan(rawPlan) {
  return WEEK_DAYS.map((day, index) => {
    const entry = rawPlan[index] || rawPlan[index % Math.max(1, rawPlan.length)];
    const dinner = recipeToMeal(entry?.recipe, "Planned dinner");
    const lunch = index > 0 && rawPlan[index - 1]?.recipe ? recipeToMeal(rawPlan[index - 1].recipe, "Leftover lunch") : emptyMeal("High protein lunch");
    if (lunch.name !== "High protein lunch") lunch.name = `Leftover ${lunch.name}`;
    return {
      day,
      prepTask: entry?.prepTask || "",
      meals: {
        breakfast: emptyMeal("Protein breakfast"),
        lunch,
        dinner,
        snack: emptyMeal("Flexible snack"),
      },
    };
  });
}

function ensureWeekPlan(plan) {
  const existingByDay = new Map((plan || []).map((entry) => [entry.day, entry]));
  return WEEK_DAYS.map((day) => {
    const existing = existingByDay.get(day);
    return {
      day,
      prepTask: existing?.prepTask || "",
      meals: {
        breakfast: existing?.meals?.breakfast || emptyMeal(""),
        lunch: existing?.meals?.lunch || emptyMeal(""),
        dinner: existing?.meals?.dinner || emptyMeal(""),
        snack: existing?.meals?.snack || emptyMeal(""),
      },
    };
  });
}

function planMeals(entry) {
  if (entry?.meals) return MEAL_TYPES.map((type) => entry.meals[type]).filter(Boolean);
  return entry?.recipe ? [recipeToMeal(entry.recipe)] : [];
}

function planRecipes(plan) {
  return plan.flatMap((entry) => planMeals(entry).filter((meal) => meal.ingredients?.length));
}

function calculateMealsMacroTotals(meals) {
  return meals.reduce(
    (totals, meal) => ({
      calories: totals.calories + macroValue(meal.macros, "calories"),
      protein: totals.protein + macroValue(meal.macros, "protein"),
      carbs: totals.carbs + macroValue(meal.macros, "carbs"),
      fat: totals.fat + macroValue(meal.macros, "fat"),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

function calculatePlanMacroTotals(plan) {
  return calculateMealsMacroTotals(plan.flatMap(planMeals));
}

function emptyDailyLogEntry() {
  return {
    entries: [],
    exercise: { caloriesBurned: 0, minutes: 0, type: "", notes: "" },
  };
}

function calculateDailyLogTotals(dayLog) {
  return calculateMealsMacroTotals(dayLog.entries || []);
}

const FOOD_MACRO_LIBRARY = [
  { terms: ["greek yogurt", "yogurt"], macros: { calories: 130, protein: 20, carbs: 8, fat: 0 } },
  { terms: ["egg", "eggs"], macros: { calories: 70, protein: 6, carbs: 1, fat: 5 } },
  { terms: ["chicken breast", "chicken"], macros: { calories: 165, protein: 31, carbs: 0, fat: 4 } },
  { terms: ["rice", "brown rice"], macros: { calories: 215, protein: 5, carbs: 45, fat: 2 } },
  { terms: ["tuna"], macros: { calories: 120, protein: 26, carbs: 0, fat: 1 } },
  { terms: ["whey", "protein powder", "gold standard"], macros: { calories: 120, protein: 24, carbs: 3, fat: 1 } },
  { terms: ["milk", "oat milk"], macros: { calories: 120, protein: 3, carbs: 16, fat: 5 } },
  { terms: ["cheese", "parmesan", "babybel"], macros: { calories: 110, protein: 7, carbs: 1, fat: 9 } },
  { terms: ["spinach", "greens", "kale"], macros: { calories: 25, protein: 3, carbs: 4, fat: 0 } },
  { terms: ["avocado"], macros: { calories: 240, protein: 3, carbs: 13, fat: 22 } },
  { terms: ["beans", "black beans"], macros: { calories: 220, protein: 14, carbs: 40, fat: 1 } },
  { terms: ["pretzels"], macros: { calories: 110, protein: 3, carbs: 23, fat: 1 } },
  { terms: ["fruit snacks"], macros: { calories: 80, protein: 0, carbs: 19, fat: 0 } },
];

function textMatchesFood(text, candidate) {
  const normalized = String(text || "").toLowerCase();
  return candidate.terms.some((term) => normalized.includes(term) || term.includes(normalized));
}

function findMacroEstimate(foodName, plannedMeals = []) {
  if (!String(foodName || "").trim()) return null;
  const plannedMatch = plannedMeals.find((meal) => textMatchesFood(foodName, { terms: [meal.name || ""] }) && isMealEntered(meal));
  if (plannedMatch) return plannedMatch.macros;
  return FOOD_MACRO_LIBRARY.find((candidate) => textMatchesFood(foodName, candidate))?.macros || null;
}

function ingredientMatchesInventoryItem(ingredient, item) {
  const ingredientName = String(ingredient || "").toLowerCase();
  const itemName = String(item.name || "").toLowerCase();
  if (!ingredientName || !itemName) return false;

  const ingredientWords = ingredientName.split(/\s+/).filter((word) => word.length > 2);
  const itemWords = itemName.split(/\s+/).filter((word) => word.length > 2);
  return ingredientWords.some((word) => itemName.includes(word)) || itemWords.some((word) => ingredientName.includes(word));
}

function buildMealPlanGrocerySuggestions(plan, inventory, shoppingList) {
  const required = new Map();
  for (const meal of planRecipes(plan)) {
    for (const ingredient of meal.ingredients || []) {
      const key = ingredient.toLowerCase();
      const current = required.get(key) || { name: ingredient, needed: 0, recipes: new Set() };
      current.needed += 1;
      current.recipes.add(meal.name);
      required.set(key, current);
    }
  }

  const existingShoppingNames = new Set(shoppingList.map((item) => String(item.name || "").toLowerCase()));
  return [...required.values()]
    .map((ingredient) => {
      const available = inventory
        .filter((item) => ingredientMatchesInventoryItem(ingredient.name, item))
        .reduce((sum, item) => sum + Math.max(0, Number(item.quantity || 0)), 0);
      const shortage = Math.max(0, ingredient.needed - available);
      return {
        id: `meal-plan-${ingredient.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: ingredient.name,
        quantity: shortage,
        unit: "meal unit",
        reason: `Meal plan shortage for ${ingredient.recipes.size} recipe${ingredient.recipes.size === 1 ? "" : "s"}`,
        available,
        needed: ingredient.needed,
        recipes: [...ingredient.recipes],
      };
    })
    .filter((suggestion) => suggestion.quantity > 0 && !existingShoppingNames.has(suggestion.name.toLowerCase()))
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
}

function App() {
  const [activeTab, setActiveTab] = useState("pantry");
  const [inventory, setInventory] = useState(seedInventory);
  const [savedShoppingList, setSavedShoppingList] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", quantity: 1, unit: "pcs", expirationDate: offsetDate(7), category: "pantry" });
  const [scanLog, setScanLog] = useState("BARCODE READY");
  const [barcode, setBarcode] = useState("");
  const [syncMode, setSyncMode] = useState("CONNECTING");
  const [recipes, setRecipes] = useState([]);
  const [recipeQuery, setRecipeQuery] = useState("");
  const [recipeRecommendations, setRecipeRecommendations] = useState([]);
  const [mealPlan, setMealPlan] = useState([]);
  const [dailyLog, setDailyLog] = useState({});
  const [selectedLogDay, setSelectedLogDay] = useState(WEEK_DAYS[new Date().getDay()]);
  const [macroGoals, setMacroGoals] = useState({ calories: 2100, protein: 140, carbs: 220, fat: 70 });
  const [planGenerateTarget, setPlanGenerateTarget] = useState({ scope: "week", day: WEEK_DAYS[new Date().getDay()], mealType: "dinner" });
  const [groceryForm, setGroceryForm] = useState({ name: "", quantity: 1, unit: "pcs" });
  const fileInputRef = useRef(null);
  const pantryFormRef = useRef(null);

  useEffect(() => {
    let active = true;
    async function refresh() {
      const [result, savedList] = await Promise.all([loadInventory(), loadSavedShoppingList()]);
      if (!active) return;
      setInventory(result.items);
      setSavedShoppingList(savedList.items);
      setSyncMode(result.mode);
    }
    refresh();
    const intervalId = window.setInterval(refresh, 2500);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function loadPlanningState() {
      const [savedPlan, savedLog] = await Promise.all([loadSavedMealPlan(), loadDailyLog()]);
      if (!active) return;
      setMealPlan(savedPlan.plan);
      setDailyLog(savedLog.log);
      if (savedLog.log.__macroGoals) setMacroGoals(savedLog.log.__macroGoals);
    }
    loadPlanningState();
    return () => {
      active = false;
    };
  }, []);

  const autoShoppingList = useMemo(() => {
    return inventory
      .map((item) => ({ ...item, status: getItemStatus(item) }))
      .filter((item) => item.status.expired || item.status.low || item.status.zeroItem)
      .map((item) => ({
        id: `needed-${item.id}`,
        name: item.name,
        quantity: item.status.zeroItem ? 1 : Math.max(1, LOW_QUANTITY_THRESHOLD + 1 - Number(item.quantity || 0)),
        unit: item.unit,
        reason: item.status.expired ? "Expired" : item.status.zeroItem ? "Out of stock" : "Low stock",
      }));
  }, [inventory]);

  const shoppingList = useMemo(() => {
    const merged = [...savedShoppingList];
    const savedIds = new Set(merged.map((item) => item.id));
    for (const item of autoShoppingList) {
      if (!savedIds.has(item.id)) merged.push(item);
    }
    return merged;
  }, [autoShoppingList, savedShoppingList]);

  const mealPlanGrocerySuggestions = useMemo(() => buildMealPlanGrocerySuggestions(mealPlan, inventory, shoppingList), [mealPlan, inventory, shoppingList]);

  function grocerySuggestionsForRecipe(recipe) {
    return buildMealPlanGrocerySuggestions([{ day: "Selected", recipe }], inventory, shoppingList);
  }

  useEffect(() => {
    if (!autoShoppingList.length) return;
    const savedIds = new Set(savedShoppingList.map((item) => item.id));
    const missingAutoItems = autoShoppingList.filter((item) => !savedIds.has(item.id));
    if (!missingAutoItems.length) return;
    const next = [...savedShoppingList, ...missingAutoItems];
    setSavedShoppingList(next);
    saveShoppingList(next);
  }, [autoShoppingList, savedShoppingList]);

  const expiringCount = inventory.filter((item) => getItemStatus(item).urgent || getItemStatus(item).expired).length;

  function resetForm() {
    setEditing(null);
    setForm({ name: "", quantity: 1, unit: "pcs", expirationDate: offsetDate(7), category: "pantry" });
  }

  async function refreshInventory() {
    const [result, savedList] = await Promise.all([loadInventory(), loadSavedShoppingList()]);
    setInventory(result.items);
    setSavedShoppingList(savedList.items);
    setSyncMode(result.mode);
  }

  async function saveItem(event) {
    event.preventDefault();
    const nextItem = {
      id: editing ?? uid(),
      name: form.name.trim(),
      quantity: Number(form.quantity),
      unit: form.unit.trim() || "pcs",
      expirationDate: form.expirationDate,
      category: form.category || "pantry",
    };
    if (!nextItem.name) return;
    const mode = await saveInventoryItem(nextItem, editing);
    setSyncMode(mode);
    await refreshInventory();
    resetForm();
  }

  function editItem(item) {
    setEditing(item.id);
    setForm({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      expirationDate: item.expirationDate,
      category: normalizeStorageZone(item),
    });
    requestAnimationFrame(() => {
      pantryFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function deleteItem(id) {
    const mode = await deleteInventoryItem(id);
    setSyncMode(mode);
    await refreshInventory();
  }

  async function removeShoppingItem(id) {
    setSavedShoppingList((items) => items.filter((item) => item.id !== id));
    const mode = await deleteShoppingListItem(id);
    setSyncMode(mode);
    const savedList = await loadSavedShoppingList();
    setSavedShoppingList(savedList.items);
  }

  async function addMealPlanSuggestionsToShopping(suggestions) {
    if (!suggestions.length) return;
    const existingIds = new Set(shoppingList.map((item) => item.id));
    const existingNames = new Set(shoppingList.map((item) => String(item.name || "").toLowerCase()));
    const additions = suggestions
      .filter((item) => !existingIds.has(item.id) && !existingNames.has(item.name.toLowerCase()))
      .map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        reason: item.reason,
      }));
    if (!additions.length) return;
    const next = [...savedShoppingList, ...additions];
    setSavedShoppingList(next);
    const mode = await saveShoppingList(next);
    setSyncMode(mode);
  }

  async function addManualShoppingItem(event) {
    event.preventDefault();
    const name = groceryForm.name.trim();
    if (!name) return;
    const nextItem = {
      id: `manual-${uid()}`,
      name,
      quantity: Number(groceryForm.quantity) || 1,
      unit: groceryForm.unit.trim() || "pcs",
      reason: "Manual add",
    };
    const next = [nextItem, ...savedShoppingList];
    setSavedShoppingList(next);
    const mode = await saveShoppingList(next);
    setSyncMode(mode);
    setGroceryForm({ name: "", quantity: 1, unit: "pcs" });
  }

  async function handleImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setScanLog("DECODING BARCODE");
    try {
      const detectedBarcode = await decodeBarcodeFromImage(file);
      setBarcode(detectedBarcode);
      await addBarcodeItem(detectedBarcode);
    } catch (error) {
      setScanLog(error.message.includes("supported") ? "TYPE BARCODE BELOW" : "NO BARCODE FOUND");
    } finally {
      event.target.value = "";
    }
  }

  async function addBarcodeItem(nextBarcode = barcode) {
    const cleanBarcode = String(nextBarcode).replace(/\D/g, "");
    if (!cleanBarcode) {
      setScanLog("ENTER BARCODE");
      return;
    }

    setScanLog("LOOKING UP PRODUCT");
    try {
      const product = await lookupBarcode(cleanBarcode);
      const nextItem = {
        id: uid(),
        name: product.name,
        quantity: 1,
        unit: product.quantityLabel || "item",
        expirationDate: offsetDate(14),
        category: inferStorageZone({ name: product.name, unit: product.quantityLabel || "item" }),
        barcode: product.barcode,
      };
      const mode = await saveInventoryItem(nextItem);
      setSyncMode(mode);
      await refreshInventory();
      setScanLog(`ADDED ${product.name}`);
      setBarcode("");
    } catch {
      setScanLog("BARCODE NOT FOUND");
      setForm((current) => ({ ...current, name: `Barcode ${cleanBarcode}`, unit: "item" }));
    }
  }

  async function generateRecipes() {
    setRecipes([]);
    const result = await findReferencedRecipes(inventory, recipeQuery, shoppingList);
    setRecipes(result);
  }

  useEffect(() => {
    let active = true;
    async function refreshRecommendations() {
      const result = await recommendExpiringRecipes(inventory);
      if (active) setRecipeRecommendations(result);
    }
    refreshRecommendations();
    return () => {
      active = false;
    };
  }, [inventory]);

  async function generateMealPlan() {
    const result = await buildWeeklyMealPrepPlan(inventory, shoppingList);
    const editablePlan = createEditableWeekPlan(result);
    const next =
      planGenerateTarget.scope === "week"
        ? editablePlan.map((generatedEntry) => {
            const existingEntry = mealPlan.find((entry) => entry.day === generatedEntry.day);
            if (!existingEntry) return generatedEntry;
            return {
              ...generatedEntry,
              meals: Object.fromEntries(
                MEAL_TYPES.map((type) => [type, isMealEntered(existingEntry.meals?.[type]) ? existingEntry.meals[type] : generatedEntry.meals[type]]),
              ),
            };
          })
        : ensureWeekPlan(mealPlan).map((entry) => {
            if (entry.day !== planGenerateTarget.day) return entry;
            const generatedEntry = editablePlan.find((candidate) => candidate.day === planGenerateTarget.day);
            const generatedMeal = generatedEntry?.meals?.[planGenerateTarget.mealType] || emptyMeal("");
            const currentMeal = entry.meals?.[planGenerateTarget.mealType];
            if (isMealEntered(currentMeal)) return entry;
            return { ...entry, meals: { ...entry.meals, [planGenerateTarget.mealType]: generatedMeal } };
          });
    setMealPlan(next);
    const mode = await saveMealPlan(next);
    setSyncMode(mode);
  }

  async function addRecipeToMealSlots(recipe, slots) {
    if (!slots.length) return;
    const next = ensureWeekPlan(mealPlan).map((entry) => {
      const matchingSlots = slots.filter((slot) => slot.day === entry.day);
      if (!matchingSlots.length) return entry;
      const meals = { ...entry.meals };
      for (const slot of matchingSlots) {
        meals[slot.mealType] = recipeToMeal(recipe, recipe.title);
      }
      return { ...entry, meals };
    });
    setMealPlan(next);
    const mode = await saveMealPlan(next);
    setSyncMode(mode);
  }

  async function updateMealSlot(day, mealType, patch) {
    const next = mealPlan.map((entry) => {
      if (entry.day !== day) return entry;
      const currentMeal = entry.meals?.[mealType] || emptyMeal();
      return {
        ...entry,
        meals: {
          ...entry.meals,
          [mealType]: {
            ...currentMeal,
            ...patch,
            macros: { ...currentMeal.macros, ...(patch.macros || {}) },
          },
        },
      };
    });
    setMealPlan(next);
    const mode = await saveMealPlan(next);
    setSyncMode(mode);
  }

  async function clearMealSlot(day, mealType) {
    await updateMealSlot(day, mealType, emptyMeal(""));
  }

  async function clearAllMealSlots() {
    const next = emptyWeekPlan();
    setMealPlan(next);
    const mode = await saveMealPlan(next);
    setSyncMode(mode);
  }

  async function addDailyFood(day, entry) {
    const current = dailyLog[day] || emptyDailyLogEntry();
    const next = {
      ...dailyLog,
      [day]: {
        ...current,
        entries: [{ ...entry, id: uid() }, ...(current.entries || [])],
      },
    };
    setDailyLog(next);
    const mode = await saveDailyLog(next);
    setSyncMode(mode);
  }

  async function markMealDone(day, mealType, meal) {
    if (!isMealEntered(meal)) return;
    await addDailyFood(day, {
      mealType,
      name: meal.name || MEAL_TYPE_LABELS[mealType],
      macros: {
        calories: macroValue(meal.macros, "calories"),
        protein: macroValue(meal.macros, "protein"),
        carbs: macroValue(meal.macros, "carbs"),
        fat: macroValue(meal.macros, "fat"),
      },
      sourceMealId: meal.id,
    });
  }

  async function updateMacroGoals(nextGoals) {
    setMacroGoals(nextGoals);
    const next = { ...dailyLog, __macroGoals: nextGoals };
    setDailyLog(next);
    const mode = await saveDailyLog(next);
    setSyncMode(mode);
  }

  async function removeDailyFood(day, id) {
    const current = dailyLog[day] || emptyDailyLogEntry();
    const next = {
      ...dailyLog,
      [day]: {
        ...current,
        entries: (current.entries || []).filter((entry) => entry.id !== id),
      },
    };
    setDailyLog(next);
    const mode = await saveDailyLog(next);
    setSyncMode(mode);
  }

  async function updateExercise(day, exercise) {
    const current = dailyLog[day] || emptyDailyLogEntry();
    const next = {
      ...dailyLog,
      [day]: {
        ...current,
        exercise,
      },
    };
    setDailyLog(next);
    const mode = await saveDailyLog(next);
    setSyncMode(mode);
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#030504] text-mint-100">
      <div className="scanlines" />
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-3 py-4 sm:px-5 lg:px-8">
        <Header expiringCount={expiringCount} neededCount={shoppingList.length} syncMode={syncMode} />
        <Nav activeTab={activeTab} onChange={setActiveTab} />

        <section className="grid flex-1 gap-3 border-x border-mint-500/50 p-3 sm:p-4 lg:grid-cols-[1.05fr_0.95fr]">
          {activeTab === "pantry" && (
            <>
              <Panel title="PANTRY MATRIX" meta={`${inventory.length} ITEMS`}>
                <div ref={pantryFormRef}>
                  <CameraBar onCamera={() => fileInputRef.current?.click()} scanLog={scanLog} barcode={barcode} setBarcode={setBarcode} onBarcodeLookup={() => addBarcodeItem()} />
                  <input ref={fileInputRef} className="hidden" type="file" accept="image/*" capture="environment" onChange={handleImage} />
                  <ItemForm form={form} setForm={setForm} editing={editing} onSave={saveItem} onCancel={resetForm} />
                </div>
              </Panel>
              <Panel title="COLD STORAGE" meta="LIVE">
                <InventoryGrid items={inventory} onEdit={editItem} onDelete={deleteItem} />
              </Panel>
            </>
          )}

          {activeTab === "shopping" && (
            <>
              <Panel title="NEEDED QUEUE" meta={`${shoppingList.length} AUTO`}>
                <GroceryAddForm form={groceryForm} setForm={setGroceryForm} onSubmit={addManualShoppingItem} />
                <ShoppingList items={shoppingList} onDelete={removeShoppingItem} />
              </Panel>
              <Panel title="AUTOMATION RULES" meta="48H">
                <RuleConsole />
              </Panel>
            </>
          )}

          {activeTab === "recipes" && (
            <>
              <Panel title="RECIPE SEARCH" meta="ONLINE">
                <RecipeConsole
                  onGenerate={generateRecipes}
                  recipes={recipes}
                  query={recipeQuery}
                  setQuery={setRecipeQuery}
                  recommendations={recipeRecommendations}
                  getGrocerySuggestions={grocerySuggestionsForRecipe}
                  onAddGroceries={addMealPlanSuggestionsToShopping}
                  onAddRecipeToMealSlots={addRecipeToMealSlots}
                />
              </Panel>
              <Panel title="SOURCE RULES" meta="LINKED">
                <RuleConsole />
              </Panel>
            </>
          )}

          {activeTab === "mealPrep" && (
            <>
              <Panel title="MACRO PLAN" meta="7 DAYS">
                <MealPrepConsole
                  onGenerate={generateMealPlan}
                  plan={mealPlan}
                  grocerySuggestions={mealPlanGrocerySuggestions}
                  onAddGroceries={addMealPlanSuggestionsToShopping}
                  onUpdateMeal={updateMealSlot}
                  onClearMeal={clearMealSlot}
                  onClearAllMeals={clearAllMealSlots}
                  onMarkMealDone={markMealDone}
                  generateTarget={planGenerateTarget}
                  setGenerateTarget={setPlanGenerateTarget}
                />
              </Panel>
              <Panel title="SHOPPING GAPS" meta="AUTO">
                <MealPlanGrocerySuggestions suggestions={mealPlanGrocerySuggestions} onAddGroceries={addMealPlanSuggestionsToShopping} />
              </Panel>
            </>
          )}

          {activeTab === "macros" && (
            <>
              <Panel title="MACRO TRACKER" meta="RECOMP">
                <MacroTrackerConsole
                  plan={mealPlan}
                  goals={macroGoals}
                  setGoals={updateMacroGoals}
                  dailyLog={dailyLog}
                  selectedDay={selectedLogDay}
                  setSelectedDay={setSelectedLogDay}
                  onAddDailyFood={addDailyFood}
                  onRemoveDailyFood={removeDailyFood}
                  onUpdateExercise={updateExercise}
                />
              </Panel>
              <Panel title="WEEKLY EXERCISE" meta="BURN">
                <WeeklyExerciseSummary dailyLog={dailyLog} />
              </Panel>
            </>
          )}
        </section>

        <footer className="border border-mint-500/50 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-mint-300/70">
          SmartPantry PWA // Shared API DB // Barcode lookup // Recipes source-linked
        </footer>
      </div>
    </main>
  );
}

function Header({ expiringCount, neededCount, syncMode }) {
  return (
    <header className="border border-mint-500/60 bg-black/70 p-3 shadow-[0_0_28px_rgba(70,255,188,0.12)]">
      <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.22em] text-mint-300/80">
        <span>SP BIOS (PWA)</span>
        <span>{syncMode}</span>
        <span>Ver 1.03</span>
      </div>
      <div className="mt-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.45em] text-mint-300">SmartPantry</p>
          <h1 className="mt-1 text-4xl font-black uppercase leading-none text-mint-200 sm:text-6xl">Kitchen OS</h1>
        </div>
        <div className="grid grid-cols-2 gap-2 font-mono text-xs uppercase">
          <StatusPill label="Expiry alerts" value={expiringCount} />
          <StatusPill label="Needed" value={neededCount} />
        </div>
      </div>
    </header>
  );
}

function StatusPill({ label, value }) {
  return (
    <div className="border border-mint-500/50 bg-mint-500/5 px-3 py-2 text-right">
      <div className="text-xl font-black text-mint-100">{value}</div>
      <div className="text-[10px] text-mint-300/70">{label}</div>
    </div>
  );
}

function Nav({ activeTab, onChange }) {
  const tabs = [
    ["pantry", "Pantry", Warehouse],
    ["shopping", "Shopping List", ShoppingCart],
    ["recipes", "Recipe Finder", Search],
    ["mealPrep", "Meal Prep", CalendarDays],
    ["macros", "Macro Tracker", Gauge],
  ];
  return (
    <nav className="grid grid-cols-2 border-x border-mint-500/50 bg-black/80 min-[520px]:grid-cols-5">
      {tabs.map(([id, label, Icon]) => (
        <button
          key={id}
          aria-label={label}
          onClick={() => onChange(id)}
          className={`flex min-h-14 items-center justify-center gap-1.5 border-b border-r border-mint-500/50 px-1.5 font-mono text-[10px] uppercase tracking-[0.08em] transition min-[380px]:gap-2 min-[380px]:text-[11px] sm:px-2 sm:text-sm sm:tracking-[0.18em] ${
            activeTab === id ? "bg-mint-400 text-black shadow-[inset_0_0_20px_rgba(184,255,223,0.9)]" : "text-mint-200 hover:bg-mint-500/10"
          }`}
        >
          <Icon className="shrink-0" size={16} />
          <span className="leading-tight">{label}</span>
        </button>
      ))}
    </nav>
  );
}

function Panel({ title, meta, children }) {
  return (
    <section className="min-h-[320px] border border-mint-500/50 bg-black/65 p-3 shadow-[inset_0_0_28px_rgba(70,255,188,0.06)]">
      <div className="mb-3 flex items-center justify-between border-b border-mint-500/40 pb-2 font-mono text-xs uppercase tracking-[0.2em]">
        <h2 className="text-mint-100">{title}</h2>
        <span className="text-mint-300/70">{meta}</span>
      </div>
      {children}
    </section>
  );
}

function CameraBar({ onCamera, scanLog, barcode, setBarcode, onBarcodeLookup }) {
  return (
    <div className="mb-3 grid gap-2 border border-mint-500/40 bg-mint-500/5 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.2em] text-mint-300">
          <ScanLine size={18} />
          <span>{scanLog}</span>
        </div>
        <button onClick={onCamera} className="inline-flex min-h-11 items-center justify-center gap-2 border border-mint-300 bg-mint-300 px-4 font-mono text-xs uppercase tracking-[0.18em] text-black">
          <Camera size={16} />
          Scan Barcode
        </button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          inputMode="numeric"
          value={barcode}
          onChange={(event) => setBarcode(event.target.value)}
          placeholder="UPC / EAN barcode"
          className="min-h-11 flex-1 border border-mint-500/40 bg-black px-3 text-base text-mint-100 outline-none ring-mint-300 transition focus:ring-2"
        />
        <button onClick={onBarcodeLookup} className="inline-flex min-h-11 items-center justify-center border border-mint-500/70 px-4 font-mono text-xs uppercase tracking-[0.18em] text-mint-200">
          Lookup
        </button>
      </div>
    </div>
  );
}

function ItemForm({ form, setForm, editing, onSave, onCancel }) {
  return (
    <form onSubmit={onSave} className="grid gap-2 font-mono text-xs uppercase sm:grid-cols-2">
      <Input label="Item Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} placeholder="Avocados" />
      <Input label="Quantity" type="number" min="0" step="0.25" value={form.quantity} onChange={(value) => setForm({ ...form, quantity: value })} />
      <Input label="Unit" value={form.unit} onChange={(value) => setForm({ ...form, unit: value })} placeholder="pcs" />
      <Input label="Expiration" type="date" value={form.expirationDate} onChange={(value) => setForm({ ...form, expirationDate: value })} />
      <label className="grid gap-1 text-mint-300/75 sm:col-span-2">
        <span>Storage Zone</span>
        <select
          value={form.category}
          onChange={(event) => setForm({ ...form, category: event.target.value })}
          className="min-h-11 border border-mint-500/40 bg-black px-3 text-base text-mint-100 outline-none ring-mint-300 transition focus:ring-2"
        >
          {STORAGE_ZONES.map((zone) => (
            <option key={zone} value={zone}>
              {STORAGE_ZONE_LABELS[zone]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 border border-mint-300 bg-mint-300 px-4 font-black text-black">
          {editing ? <Check size={16} /> : <Plus size={16} />}
          {editing ? "Update" : "Add Item"}
        </button>
        {editing && (
          <button type="button" onClick={onCancel} className="inline-flex min-h-11 items-center justify-center border border-mint-500/60 px-4 text-mint-200">
            <X size={16} />
          </button>
        )}
      </div>
    </form>
  );
}

function Input({ label, value, onChange, ...props }) {
  return (
    <label className="grid gap-1 text-mint-300/75">
      <span>{label}</span>
      <input
        {...props}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 border border-mint-500/40 bg-black px-3 text-base text-mint-100 outline-none ring-mint-300 transition focus:ring-2"
      />
    </label>
  );
}

function InventoryGrid({ items, onEdit, onDelete }) {
  const grouped = STORAGE_ZONES.map((zone) => ({
    zone,
    items: items
      .filter((item) => normalizeStorageZone(item) === zone)
      .sort((a, b) => new Date(a.expirationDate) - new Date(b.expirationDate) || a.name.localeCompare(b.name)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="space-y-4">
      {grouped.map((group) => (
        <section key={group.zone}>
          <div className="mb-2 flex items-center justify-between border-b border-mint-500/40 pb-1 font-mono text-xs uppercase tracking-[0.18em] text-mint-300">
            <span>{STORAGE_ZONE_LABELS[group.zone]}</span>
            <span>{group.items.length}</span>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {group.items.map((item) => {
              const status = getItemStatus(item);
              const tone = status.expired ? "border-red-400 bg-red-950/40 text-red-100" : status.urgent ? "border-yellow-300 bg-yellow-300/10 text-yellow-100" : "border-mint-500/40 bg-mint-500/5 text-mint-100";
              return (
                <article key={item.id} className={`border p-3 ${tone}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-black uppercase leading-tight">{item.name}</h3>
                      <p className="mt-1 font-mono text-xs uppercase opacity-75">
                        {item.quantity} {item.unit} // Exp {formatDate(item.expirationDate)}
                      </p>
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] opacity-60">{STORAGE_ZONE_LABELS[normalizeStorageZone(item)]}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <IconButton label="Edit" onClick={() => onEdit(item)} icon={<Edit3 size={16} />} />
                      <IconButton label="Delete" onClick={() => onDelete(item.id)} icon={<Trash2 size={16} />} />
                    </div>
                  </div>
                  <div className="mt-3 h-2 border border-current p-[2px]">
                    <div className="h-full bg-current" style={{ width: `${Math.min(100, Math.max(10, Number(item.quantity) * 18))}%` }} />
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
      {!grouped.length && <EmptyState text="NO PANTRY ITEMS" />}
    </div>
  );
}

function IconButton({ label, onClick, icon }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="grid size-9 place-items-center border border-current bg-black/45 transition hover:bg-current hover:text-black">
      {icon}
    </button>
  );
}

function GroceryAddForm({ form, setForm, onSubmit }) {
  return (
    <form onSubmit={onSubmit} className="mb-3 grid gap-2 border border-mint-500/40 bg-mint-500/5 p-3 font-mono text-xs uppercase sm:grid-cols-[1fr_90px_100px_auto]">
      <Input label="Add Grocery" value={form.name} onChange={(value) => setForm({ ...form, name: value })} placeholder="Bananas" />
      <Input label="Qty" type="number" min="0" step="0.25" value={form.quantity} onChange={(value) => setForm({ ...form, quantity: value })} />
      <Input label="Unit" value={form.unit} onChange={(value) => setForm({ ...form, unit: value })} placeholder="pcs" />
      <button className="inline-flex min-h-11 items-center justify-center gap-2 self-end border border-mint-300 bg-mint-300 px-4 font-black text-black">
        <Plus size={16} />
        Add
      </button>
    </form>
  );
}

function ShoppingList({ items, onDelete }) {
  if (!items.length) return <EmptyState text="NO NEEDED ENTRIES" />;
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.id} className="flex items-center justify-between gap-3 border border-mint-500/40 bg-mint-500/5 p-3">
          <div>
            <h3 className="font-black uppercase">{item.name}</h3>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-mint-300/75">{item.reason}</p>
          </div>
          <span className="font-mono text-sm uppercase text-mint-100">
            {item.quantity} {item.unit}
          </span>
          <IconButton label="Remove from grocery list" onClick={() => onDelete(item.id)} icon={<Trash2 size={16} />} />
        </div>
      ))}
    </div>
  );
}

function RuleConsole() {
  return (
    <div className="space-y-3 font-mono text-xs uppercase tracking-[0.16em] text-mint-300/80">
      <Rule line="IF EXPIRATION <= 48H THEN ALERT COLOR = AMBER" />
      <Rule line="IF EXPIRATION < TODAY THEN ALERT COLOR = RED" />
      <Rule line="IF EXPIRED OR QUANTITY = 0 THEN CLONE TO NEEDED QUEUE" />
      <Rule line="SORT INVENTORY BY FRIDGE, FREEZER, PANTRY, SEASONINGS" />
      <Rule line="DATABASE = SHARED API WHEN ONLINE, LOCALSTORAGE FALLBACK WHEN OFFLINE" />
    </div>
  );
}

function Rule({ line }) {
  return <div className="border-l-2 border-mint-300 bg-mint-300/5 px-3 py-2">{line}</div>;
}

function RecipeConsole({ onGenerate, recipes, query, setQuery, recommendations, getGrocerySuggestions, onAddGroceries, onAddRecipeToMealSlots }) {
  return (
    <div>
      <div className="mb-3 grid gap-2">
        <label className="grid gap-1 font-mono text-xs uppercase tracking-[0.16em] text-mint-300/75">
          <span>Cuisine / star ingredient</span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Italian, tuna, rice, high protein..."
              className="min-h-11 flex-1 border border-mint-500/40 bg-black px-3 text-base normal-case tracking-normal text-mint-100 outline-none ring-mint-300 transition focus:ring-2"
            />
            <button onClick={onGenerate} className="inline-flex min-h-11 items-center justify-center gap-2 border border-mint-300 bg-mint-300 px-4 font-mono text-xs font-black uppercase tracking-[0.18em] text-black">
              <Search size={16} />
              Search
            </button>
          </div>
        </label>
      </div>
      <RecommendationStrip recommendations={recommendations} getGrocerySuggestions={getGrocerySuggestions} onAddGroceries={onAddGroceries} onAddRecipeToMealSlots={onAddRecipeToMealSlots} />
      <div className="grid gap-2">
        {recipes.length ? recipes.map((recipe) => <RecipeCard key={recipe.title} recipe={recipe} grocerySuggestions={getGrocerySuggestions(recipe)} onAddGroceries={onAddGroceries} onAddRecipeToMealSlots={onAddRecipeToMealSlots} />) : <EmptyState text="AWAITING SOURCE MATCH" />}
      </div>
    </div>
  );
}

function RecipeCard({ recipe, grocerySuggestions = [], onAddGroceries, onAddRecipeToMealSlots }) {
  const [selectedSlots, setSelectedSlots] = useState([]);
  const toggleSlot = (day, mealType) => {
    const key = `${day}-${mealType}`;
    setSelectedSlots((slots) => (slots.some((slot) => `${slot.day}-${slot.mealType}` === key) ? slots.filter((slot) => `${slot.day}-${slot.mealType}` !== key) : [...slots, { day, mealType }]));
  };

  return (
    <article className="border border-mint-500/40 bg-mint-500/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-black uppercase text-mint-100">{recipe.title}</h3>
        <a className="grid size-9 shrink-0 place-items-center border border-mint-300 text-mint-200 transition hover:bg-mint-300 hover:text-black" href={recipe.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open ${recipe.title} source`} title={`Open source on ${recipe.source}`}>
          <ExternalLink size={16} />
        </a>
      </div>
      <p className="mt-1 text-sm text-mint-200/80">{recipe.summary}</p>
      <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-mint-300/75">Source: {recipe.source}</p>
      <p className="mt-1 font-mono text-xs uppercase tracking-[0.16em] text-mint-300/75">Cuisine: {recipe.cuisine}</p>
      <p className="mt-1 font-mono text-xs uppercase tracking-[0.16em] text-mint-300/75">
        Matches: {recipe.matchedIngredients.length ? recipe.matchedIngredients.join(", ") : "pantry-adjacent"}
      </p>
      {recipe.expiringMatches?.length > 0 && <p className="mt-1 font-mono text-xs uppercase tracking-[0.16em] text-yellow-200">Use soon: {recipe.expiringMatches.join(", ")}</p>}
      <MacroLine macros={recipe.macros} />
      <details className="mt-3 border border-mint-500/40 bg-black/35 p-2">
        <summary className="cursor-pointer font-mono text-[10px] font-black uppercase tracking-[0.16em] text-mint-200">Add to meal prep</summary>
        <div className="mt-2 grid gap-2">
          {WEEK_DAYS.map((day) => (
            <div key={day} className="border border-mint-500/25 p-2">
              <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-mint-300/75">{day}</p>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                {MEAL_TYPES.map((mealType) => {
                  const checked = selectedSlots.some((slot) => slot.day === day && slot.mealType === mealType);
                  return (
                    <label key={`${day}-${mealType}`} className={`flex min-h-9 items-center gap-2 border px-2 font-mono text-[10px] uppercase tracking-[0.1em] ${checked ? "border-mint-200 bg-mint-300 text-black" : "border-mint-500/40 text-mint-200"}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleSlot(day, mealType)} />
                      {MEAL_TYPE_LABELS[mealType]}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              onAddRecipeToMealSlots(recipe, selectedSlots);
              setSelectedSlots([]);
            }}
            className="inline-flex min-h-10 items-center justify-center gap-2 border border-mint-300 bg-mint-300 px-3 font-mono text-[10px] font-black uppercase tracking-[0.16em] text-black disabled:opacity-50"
            disabled={!selectedSlots.length}
          >
            <Plus size={14} />
            Add Selected
          </button>
        </div>
      </details>
      {grocerySuggestions.length > 0 && (
        <div className="mt-3 border border-yellow-300/50 bg-yellow-300/10 p-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-yellow-100">
              Missing: {grocerySuggestions.map((item) => item.name).join(", ")}
            </p>
            <button
              onClick={() => onAddGroceries(grocerySuggestions)}
              className="inline-flex min-h-9 items-center justify-center gap-2 border border-yellow-100 bg-yellow-100 px-3 font-mono text-[10px] font-black uppercase tracking-[0.14em] text-black"
            >
              <Plus size={14} />
              Add Gaps
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function RecommendationStrip({ recommendations, getGrocerySuggestions, onAddGroceries, onAddRecipeToMealSlots }) {
  if (!recommendations.length) return null;
  return (
    <div className="mb-3 border border-yellow-300/60 bg-yellow-300/10 p-3">
      <p className="mb-2 font-mono text-xs uppercase tracking-[0.18em] text-yellow-100">Recommended before expiry</p>
      <div className="grid gap-2">
        {recommendations.map((recipe) => (
          <RecipeCard key={`rec-${recipe.title}`} recipe={recipe} grocerySuggestions={getGrocerySuggestions(recipe)} onAddGroceries={onAddGroceries} onAddRecipeToMealSlots={onAddRecipeToMealSlots} />
        ))}
      </div>
    </div>
  );
}

function MacroLine({ macros }) {
  if (!macros) return null;
  return (
    <div className="mt-3 grid grid-cols-4 gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-mint-100">
      <MacroChip label="Cal" value={macros.calories} />
      <MacroChip label="Pro" value={`${macros.protein}g`} />
      <MacroChip label="Carb" value={`${macros.carbs}g`} />
      <MacroChip label="Fat" value={`${macros.fat}g`} />
    </div>
  );
}

function MacroChip({ label, value }) {
  return (
    <div className="border border-mint-500/40 bg-black/40 p-2 text-center">
      <div className="text-mint-300/70">{label}</div>
      <div className="font-black">{value}</div>
    </div>
  );
}

function MacroTrackerConsole({ plan, goals, setGoals, dailyLog, selectedDay, setSelectedDay, onAddDailyFood, onRemoveDailyFood, onUpdateExercise }) {
  const totals = calculatePlanMacroTotals(plan);
  const dailyAverage = {
    calories: Math.round(totals.calories / 7) || 0,
    protein: Math.round(totals.protein / 7) || 0,
    carbs: Math.round(totals.carbs / 7) || 0,
    fat: Math.round(totals.fat / 7) || 0,
  };

  return (
    <div>
      <MacroGoals goals={goals} setGoals={setGoals} dailyAverage={dailyAverage} />
      <DailyTracker
        plan={plan}
        goals={goals}
        dailyLog={dailyLog}
        selectedDay={selectedDay}
        setSelectedDay={setSelectedDay}
        onAddFood={onAddDailyFood}
        onRemoveFood={onRemoveDailyFood}
        onUpdateExercise={onUpdateExercise}
      />
    </div>
  );
}

function MealPrepConsole({
  onGenerate,
  plan,
  grocerySuggestions,
  onAddGroceries,
  onUpdateMeal,
  onClearMeal,
  onClearAllMeals,
  onMarkMealDone,
  generateTarget,
  setGenerateTarget,
}) {
  return (
    <div>
      <PlanGenerateControls target={generateTarget} setTarget={setGenerateTarget} onGenerate={onGenerate} />
      <WeeklyPlanEditor plan={plan} onUpdateMeal={onUpdateMeal} onClearMeal={onClearMeal} onClearAllMeals={onClearAllMeals} onMarkMealDone={onMarkMealDone} />
    </div>
  );
}

function PlanGenerateControls({ target, setTarget, onGenerate }) {
  return (
    <section className="mb-3 border border-mint-500/40 bg-mint-500/5 p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-mint-300/75">
          <span>Generate scope</span>
          <select value={target.scope} onChange={(event) => setTarget({ ...target, scope: event.target.value })} className="min-h-10 border border-mint-500/40 bg-black px-2 text-sm text-mint-100 outline-none ring-mint-300 focus:ring-2">
            <option value="week">Full week</option>
            <option value="slot">Certain day / meal</option>
          </select>
        </label>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-mint-300/75">
          <span>Day</span>
          <select value={target.day} onChange={(event) => setTarget({ ...target, day: event.target.value })} disabled={target.scope === "week"} className="min-h-10 border border-mint-500/40 bg-black px-2 text-sm text-mint-100 outline-none ring-mint-300 focus:ring-2 disabled:opacity-40">
            {WEEK_DAYS.map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-mint-300/75">
          <span>Meal</span>
          <select value={target.mealType} onChange={(event) => setTarget({ ...target, mealType: event.target.value })} disabled={target.scope === "week"} className="min-h-10 border border-mint-500/40 bg-black px-2 text-sm text-mint-100 outline-none ring-mint-300 focus:ring-2 disabled:opacity-40">
            {MEAL_TYPES.map((type) => (
              <option key={type} value={type}>
                {MEAL_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <button onClick={onGenerate} className="inline-flex min-h-10 items-center justify-center gap-2 self-end border border-mint-300 bg-mint-300 px-4 font-mono text-xs font-black uppercase tracking-[0.18em] text-black">
          <CalendarDays size={16} />
          Generate
        </button>
      </div>
    </section>
  );
}

function WeeklyPlanEditor({ plan, onUpdateMeal, onClearMeal, onClearAllMeals, onMarkMealDone }) {
  if (!plan.length) return <EmptyState text="NO WEEK PLAN LOADED" />;
  return (
    <section className="mb-3 border border-mint-500/40 bg-mint-500/5 p-3">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-mono text-xs font-black uppercase tracking-[0.18em] text-mint-200">Editable week</h3>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-mint-300/70">Breakfast / lunch / dinner / snack</span>
        </div>
        <button onClick={onClearAllMeals} className="inline-flex min-h-10 items-center justify-center gap-2 border border-red-300 px-3 font-mono text-[10px] font-black uppercase tracking-[0.16em] text-red-100">
          <Trash2 size={14} />
          Clear All Meals
        </button>
      </div>
      <div className="space-y-3">
        {plan.map((entry) => (
          <article key={entry.day} className="border border-mint-500/40 bg-black/35 p-3">
            <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h4 className="font-black uppercase text-mint-100">{entry.day}</h4>
              {entry.prepTask && <p className="text-xs text-mint-200/70">{entry.prepTask}</p>}
            </div>
            <div className="grid gap-2">
              {MEAL_TYPES.map((type) => (
                <EditableMealSlot key={`${entry.day}-${type}`} day={entry.day} type={type} meal={entry.meals?.[type] || emptyMeal()} onUpdateMeal={onUpdateMeal} onClearMeal={onClearMeal} onMarkMealDone={onMarkMealDone} />
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function EditableMealSlot({ day, type, meal, onUpdateMeal, onClearMeal, onMarkMealDone }) {
  return (
    <div className="border border-mint-500/30 bg-black/45 p-2">
      <div className="mb-2 flex items-start justify-between gap-2">
        <label className="grid flex-1 gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-mint-300/75">
          <span>{MEAL_TYPE_LABELS[type]}</span>
          <input
            value={meal.name}
            onChange={(event) => onUpdateMeal(day, type, { name: event.target.value })}
            className="min-h-10 border border-mint-500/40 bg-black px-2 text-sm normal-case tracking-normal text-mint-100 outline-none ring-mint-300 focus:ring-2"
          />
        </label>
        {meal.sourceUrl && (
          <a className="mt-5 grid size-10 shrink-0 place-items-center border border-mint-300 text-mint-200 transition hover:bg-mint-300 hover:text-black" href={meal.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open ${meal.name} source`} title={`Open source on ${meal.source}`}>
            <ExternalLink size={16} />
          </a>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MacroNumberInput label="Cal" value={meal.macros?.calories || 0} onChange={(value) => onUpdateMeal(day, type, { macros: { calories: value } })} />
        <MacroNumberInput label="Protein" value={meal.macros?.protein || 0} onChange={(value) => onUpdateMeal(day, type, { macros: { protein: value } })} />
        <MacroNumberInput label="Carbs" value={meal.macros?.carbs || 0} onChange={(value) => onUpdateMeal(day, type, { macros: { carbs: value } })} />
        <MacroNumberInput label="Fat" value={meal.macros?.fat || 0} onChange={(value) => onUpdateMeal(day, type, { macros: { fat: value } })} />
      </div>
      <label className="mt-2 grid gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-mint-300/75">
        <span>Notes</span>
        <input
          value={meal.notes || ""}
          onChange={(event) => onUpdateMeal(day, type, { notes: event.target.value })}
          className="min-h-10 border border-mint-500/40 bg-black px-2 text-sm normal-case tracking-normal text-mint-100 outline-none ring-mint-300 focus:ring-2"
        />
      </label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button onClick={() => onMarkMealDone(day, type, meal)} disabled={!isMealEntered(meal)} className="inline-flex min-h-10 items-center justify-center gap-2 border border-mint-300 bg-mint-300 px-3 font-mono text-[10px] font-black uppercase tracking-[0.16em] text-black disabled:opacity-40">
          <Check size={14} />
          Meal Done
        </button>
        <button onClick={() => onClearMeal(day, type)} className="inline-flex min-h-10 items-center justify-center gap-2 border border-red-300 px-3 font-mono text-[10px] font-black uppercase tracking-[0.16em] text-red-100">
          <Trash2 size={14} />
          Clear
        </button>
      </div>
    </div>
  );
}

function MacroNumberInput({ label, value, onChange }) {
  return (
    <label className="grid gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-mint-300/75">
      <span>{label}</span>
      <input
        type="number"
        min="0"
        step="1"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-h-10 border border-mint-500/40 bg-black px-2 text-sm tracking-normal text-mint-100 outline-none ring-mint-300 focus:ring-2"
      />
    </label>
  );
}

function DailyTracker({ plan, goals, dailyLog, selectedDay, setSelectedDay, onAddFood, onRemoveFood, onUpdateExercise }) {
  const dayPlan = plan.find((entry) => entry.day === selectedDay);
  const plannedTotals = calculateMealsMacroTotals(planMeals(dayPlan || {}));
  const log = dailyLog[selectedDay] || emptyDailyLogEntry();
  const actualTotals = calculateDailyLogTotals(log);
  const netCalories = actualTotals.calories - Number(log.exercise?.caloriesBurned || 0);

  return (
    <section className="border border-mint-500/40 bg-mint-500/5 p-3">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-mono text-xs font-black uppercase tracking-[0.18em] text-mint-200">Daily recomp log</h3>
          <p className="mt-1 text-sm text-mint-200/75">Baseline comes from the selected week plan; actuals include your added food and exercise burn.</p>
        </div>
        <select
          value={selectedDay}
          onChange={(event) => setSelectedDay(event.target.value)}
          className="min-h-10 border border-mint-500/40 bg-black px-3 font-mono text-sm uppercase text-mint-100 outline-none ring-mint-300 focus:ring-2"
        >
          {WEEK_DAYS.map((day) => (
            <option key={day} value={day}>
              {day}
            </option>
          ))}
        </select>
      </div>
      <MacroCompare goals={goals} planned={plannedTotals} actual={actualTotals} caloriesBurned={Number(log.exercise?.caloriesBurned || 0)} netCalories={netCalories} />
      <DailyFoodForm selectedDay={selectedDay} plannedMeals={planMeals(dayPlan || {})} onAddFood={onAddFood} />
      <ExerciseForm selectedDay={selectedDay} exercise={log.exercise || emptyDailyLogEntry().exercise} onUpdateExercise={onUpdateExercise} />
      <DailyFoodList selectedDay={selectedDay} entries={log.entries || []} onRemoveFood={onRemoveFood} />
    </section>
  );
}

function MacroCompare({ goals, planned, actual, caloriesBurned, netCalories }) {
  const rows = [
    ["Calories", goals.calories, planned.calories, actual.calories, ""],
    ["Protein", goals.protein, planned.protein, actual.protein, "g"],
    ["Carbs", goals.carbs, planned.carbs, actual.carbs, "g"],
    ["Fat", goals.fat, planned.fat, actual.fat, "g"],
  ];
  return (
    <div className="mb-3 grid gap-2">
      <div className="grid grid-cols-4 gap-1 font-mono text-[10px] uppercase tracking-[0.08em] text-mint-100">
        <MacroChip label="Actual" value={actual.calories} />
        <MacroChip label="Burned" value={caloriesBurned} />
        <MacroChip label="Net" value={netCalories} />
        <MacroChip label="Protein" value={`${actual.protein}g`} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse font-mono text-[10px] uppercase tracking-[0.1em]">
          <thead className="text-mint-300/75">
            <tr>
              <th className="border border-mint-500/30 p-2 text-left">Macro</th>
              <th className="border border-mint-500/30 p-2 text-right">Goal</th>
              <th className="border border-mint-500/30 p-2 text-right">Plan</th>
              <th className="border border-mint-500/30 p-2 text-right">Actual</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, goal, plan, actualValue, suffix]) => (
              <tr key={label}>
                <td className="border border-mint-500/30 p-2 text-mint-200">{label}</td>
                <td className="border border-mint-500/30 p-2 text-right">{goal}{suffix}</td>
                <td className="border border-mint-500/30 p-2 text-right">{plan}{suffix}</td>
                <td className="border border-mint-500/30 p-2 text-right">{actualValue}{suffix}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DailyFoodForm({ selectedDay, plannedMeals, onAddFood }) {
  const [food, setFood] = useState({ mealType: "breakfast", name: "", calories: 0, protein: 0, carbs: 0, fat: 0 });

  function usePlannedMeal(meal) {
    setFood({
      mealType: "dinner",
      name: meal.name,
      calories: meal.macros?.calories || 0,
      protein: meal.macros?.protein || 0,
      carbs: meal.macros?.carbs || 0,
      fat: meal.macros?.fat || 0,
    });
  }

  function updateFoodName(name) {
    const estimate = findMacroEstimate(name, plannedMeals);
    setFood((current) => ({
      ...current,
      name,
      ...(estimate
        ? {
            calories: macroValue(estimate, "calories"),
            protein: macroValue(estimate, "protein"),
            carbs: macroValue(estimate, "carbs"),
            fat: macroValue(estimate, "fat"),
          }
        : {}),
    }));
  }

  async function submitFood(event) {
    event.preventDefault();
    if (!food.name.trim()) return;
    await onAddFood(selectedDay, {
      mealType: food.mealType,
      name: food.name.trim(),
      macros: {
        calories: Number(food.calories || 0),
        protein: Number(food.protein || 0),
        carbs: Number(food.carbs || 0),
        fat: Number(food.fat || 0),
      },
    });
    setFood({ mealType: food.mealType, name: "", calories: 0, protein: 0, carbs: 0, fat: 0 });
  }

  return (
    <div className="mb-3 border border-mint-500/30 bg-black/35 p-3">
      <div className="mb-2 flex flex-wrap gap-2">
        {plannedMeals.map((meal) => (
          <button key={meal.id} type="button" onClick={() => usePlannedMeal(meal)} className="border border-mint-500/50 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-mint-200">
            Use {meal.name}
          </button>
        ))}
      </div>
      <form onSubmit={submitFood} className="grid gap-2">
        <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-mint-300/75">
            <span>Meal</span>
            <select value={food.mealType} onChange={(event) => setFood({ ...food, mealType: event.target.value })} className="min-h-10 border border-mint-500/40 bg-black px-2 text-sm text-mint-100 outline-none ring-mint-300 focus:ring-2">
              {MEAL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {MEAL_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-mint-300/75">
            <span>Had today</span>
            <input value={food.name} onChange={(event) => updateFoodName(event.target.value)} placeholder="Greek yogurt bowl" className="min-h-10 border border-mint-500/40 bg-black px-2 text-sm normal-case tracking-normal text-mint-100 outline-none ring-mint-300 focus:ring-2" />
          </label>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-mint-300/70">Macros auto-fill from planned meals and common pantry foods; edit numbers before adding if needed.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MacroNumberInput label="Cal" value={food.calories} onChange={(value) => setFood({ ...food, calories: value })} />
          <MacroNumberInput label="Protein" value={food.protein} onChange={(value) => setFood({ ...food, protein: value })} />
          <MacroNumberInput label="Carbs" value={food.carbs} onChange={(value) => setFood({ ...food, carbs: value })} />
          <MacroNumberInput label="Fat" value={food.fat} onChange={(value) => setFood({ ...food, fat: value })} />
        </div>
        <button className="inline-flex min-h-10 items-center justify-center gap-2 border border-mint-300 bg-mint-300 px-3 font-mono text-[10px] font-black uppercase tracking-[0.16em] text-black">
          <Plus size={14} />
          Add Food
        </button>
      </form>
    </div>
  );
}

function ExerciseForm({ selectedDay, exercise, onUpdateExercise }) {
  const update = (patch) => onUpdateExercise(selectedDay, { ...exercise, ...patch });
  return (
    <div className="mb-3 grid gap-2 border border-mint-500/30 bg-black/35 p-3 sm:grid-cols-2">
      <MacroNumberInput label="Calories burned" value={exercise.caloriesBurned || 0} onChange={(value) => update({ caloriesBurned: value })} />
      <MacroNumberInput label="Minutes" value={exercise.minutes || 0} onChange={(value) => update({ minutes: value })} />
      <label className="grid gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-mint-300/75">
        <span>Exercise</span>
        <input value={exercise.type || ""} onChange={(event) => update({ type: event.target.value })} placeholder="Lift + incline walk" className="min-h-10 border border-mint-500/40 bg-black px-2 text-sm normal-case tracking-normal text-mint-100 outline-none ring-mint-300 focus:ring-2" />
      </label>
      <label className="grid gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-mint-300/75">
        <span>Notes</span>
        <input value={exercise.notes || ""} onChange={(event) => update({ notes: event.target.value })} placeholder="Upper body, moderate effort" className="min-h-10 border border-mint-500/40 bg-black px-2 text-sm normal-case tracking-normal text-mint-100 outline-none ring-mint-300 focus:ring-2" />
      </label>
    </div>
  );
}

function DailyFoodList({ selectedDay, entries, onRemoveFood }) {
  if (!entries.length) return <EmptyState text="NO FOOD LOGGED TODAY" />;
  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <div key={entry.id} className="flex items-start justify-between gap-2 border border-mint-500/30 bg-black/35 p-2">
          <div>
            <h4 className="font-black uppercase text-mint-100">{entry.name}</h4>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-mint-300/75">
              {MEAL_TYPE_LABELS[entry.mealType] || entry.mealType} // {entry.macros?.calories || 0} cal // {entry.macros?.protein || 0}p {entry.macros?.carbs || 0}c {entry.macros?.fat || 0}f
            </p>
          </div>
          <IconButton label="Remove food log" onClick={() => onRemoveFood(selectedDay, entry.id)} icon={<Trash2 size={16} />} />
        </div>
      ))}
    </div>
  );
}

function MealPlanGrocerySuggestions({ suggestions, onAddGroceries }) {
  if (!suggestions.length) return null;
  return (
    <section className="mb-3 border border-yellow-300/70 bg-yellow-300/10 p-3">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-mono text-xs font-black uppercase tracking-[0.18em] text-yellow-100">Grocery gaps</h3>
          <p className="mt-1 text-sm text-yellow-100/80">Suggested from this week plan and current stock.</p>
        </div>
        <button
          onClick={() => onAddGroceries(suggestions)}
          className="inline-flex min-h-10 items-center justify-center gap-2 border border-yellow-100 bg-yellow-100 px-3 font-mono text-[10px] font-black uppercase tracking-[0.16em] text-black"
        >
          <Plus size={14} />
          Add All
        </button>
      </div>
      <div className="grid gap-2">
        {suggestions.map((item) => (
          <article key={item.id} className="border border-yellow-200/50 bg-black/35 p-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="font-black uppercase text-yellow-50">{item.name}</h4>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-yellow-100/75">
                  Need {item.needed} // Have {item.available} // Add {item.quantity}
                </p>
                <p className="mt-1 text-xs text-yellow-100/70">{item.recipes.slice(0, 2).join(", ")}</p>
              </div>
              <button
                onClick={() => onAddGroceries([item])}
                aria-label={`Add ${item.name} to grocery list`}
                title={`Add ${item.name} to grocery list`}
                className="grid size-9 shrink-0 place-items-center border border-yellow-100 text-yellow-50 transition hover:bg-yellow-100 hover:text-black"
              >
                <Plus size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MacroGoals({ goals, setGoals, dailyAverage }) {
  const [draftGoals, setDraftGoals] = useState(goals);
  useEffect(() => {
    setDraftGoals(goals);
  }, [goals]);

  const fields = [
    ["calories", "Calories", ""],
    ["protein", "Protein", "g"],
    ["carbs", "Carbs", "g"],
    ["fat", "Fat", "g"],
  ];

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setGoals(draftGoals);
      }}
      className="mb-3 border border-mint-500/40 bg-mint-500/5 p-3"
    >
      <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-mint-300">
        <Gauge size={16} />
        Macro goals / daily avg
      </div>
      <div className="grid grid-cols-2 gap-2">
        {fields.map(([key, label, suffix]) => (
          <label key={key} className="grid gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-mint-300/75">
            <span>{label}</span>
            <input
              type="number"
              min="0"
              value={draftGoals[key]}
              onChange={(event) => setDraftGoals({ ...draftGoals, [key]: Number(event.target.value) })}
              className="min-h-10 border border-mint-500/40 bg-black px-2 text-base tracking-normal text-mint-100 outline-none ring-mint-300 focus:ring-2"
            />
            <span className={dailyAverage[key] >= goals[key] * 0.9 && dailyAverage[key] <= goals[key] * 1.15 ? "text-mint-200" : "text-yellow-200"}>
              Avg {dailyAverage[key]}
              {suffix} / {goals[key]}
              {suffix}
            </span>
          </label>
        ))}
      </div>
      <button className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 border border-mint-300 bg-mint-300 px-3 font-mono text-[10px] font-black uppercase tracking-[0.16em] text-black sm:w-auto">
        <Check size={14} />
        Save Macro Goals
      </button>
    </form>
  );
}

function WeeklyExerciseSummary({ dailyLog }) {
  const rows = WEEK_DAYS.map((day) => {
    const exercise = dailyLog[day]?.exercise || emptyDailyLogEntry().exercise;
    return { day, exercise };
  });
  const totals = rows.reduce(
    (sum, row) => ({
      caloriesBurned: sum.caloriesBurned + Number(row.exercise.caloriesBurned || 0),
      minutes: sum.minutes + Number(row.exercise.minutes || 0),
    }),
    { caloriesBurned: 0, minutes: 0 },
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-mint-100">
        <MacroChip label="Burned" value={totals.caloriesBurned} />
        <MacroChip label="Minutes" value={totals.minutes} />
      </div>
      <div className="space-y-2">
        {rows.map(({ day, exercise }) => (
          <div key={day} className="border border-mint-500/35 bg-mint-500/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-mono text-xs font-black uppercase tracking-[0.16em] text-mint-100">{day}</h3>
              <span className="font-mono text-xs uppercase text-mint-300/75">
                {Number(exercise.caloriesBurned || 0)} cal / {Number(exercise.minutes || 0)} min
              </span>
            </div>
            {(exercise.type || exercise.notes) && <p className="mt-2 text-sm text-mint-200/75">{[exercise.type, exercise.notes].filter(Boolean).join(" // ")}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function MealPrepRow({ entry }) {
  return (
    <article className="border border-mint-500/40 bg-mint-500/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-mint-300/75">{entry.day}</p>
          <h3 className="mt-1 font-black uppercase text-mint-100">{entry.recipe.title}</h3>
        </div>
        <a className="grid size-9 shrink-0 place-items-center border border-mint-300 text-mint-200 transition hover:bg-mint-300 hover:text-black" href={entry.recipe.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open ${entry.recipe.title} source`} title={`Open source on ${entry.recipe.source}`}>
          <ExternalLink size={16} />
        </a>
      </div>
      <p className="mt-2 text-sm text-mint-200/80">{entry.prepTask}</p>
      <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-mint-300/75">Source: {entry.recipe.source}</p>
      <MacroLine macros={entry.recipe.macros} />
    </article>
  );
}

function ExpiryFeed({ items }) {
  const sorted = [...items].sort((a, b) => new Date(a.expirationDate) - new Date(b.expirationDate));
  return (
    <div className="space-y-2 font-mono text-xs uppercase">
      {sorted.slice(0, 8).map((item) => {
        const status = getItemStatus(item);
        return (
          <div key={item.id} className="flex justify-between border-b border-mint-500/30 py-2">
            <span>{item.name}</span>
            <span className={status.expired ? "text-red-300" : status.urgent ? "text-yellow-200" : "text-mint-300"}>{formatDate(item.expirationDate)}</span>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ text }) {
  return <div className="grid min-h-40 place-items-center border border-dashed border-mint-500/40 font-mono text-xs uppercase tracking-[0.2em] text-mint-300/60">{text}</div>;
}

createRoot(document.getElementById("root")).render(<App />);
