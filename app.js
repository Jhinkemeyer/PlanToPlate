// --- 1. CONFIG ---
const firebaseConfig = {
  apiKey: "AIzaSyCxrEfiS2rOPoMBUFoouAVkNOloexY3eeI",
  authDomain: "plantoplate-acc15.firebaseapp.com",
  projectId: "plantoplate-acc15",
  storageBucket: "plantoplate-acc15.firebasestorage.app",
  messagingSenderId: "825713859142",
  appId: "1:825713859142:web:f4727bd81c06feb1ba4847",
  measurementId: "G-4KNEZEVR2P",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

let currentEventId = null;
let currentEventTitle = null;
let calendar;
let weeksData = {};

// --- 2. INIT ---
document.addEventListener("DOMContentLoaded", function () {
  var calendarEl = document.getElementById("calendar");
  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: "dayGridMonth",
    headerToolbar: {
      left: "prev,next today",
      center: "title",
      right: "dayGridMonth,listWeek",
    },
    height: "auto",
    dayMaxEvents: false, // ALLOW STACKING (Multiple meals per day)
    dateClick: function (info) {
      let meal = prompt("What are we cooking on " + info.dateStr + "?");
      if (meal) saveMealToDate(info.dateStr, meal);
    },
    eventClick: function (info) {
      currentEventId = info.event.id;
      currentEventTitle = info.event.title;
      document.getElementById("eventOptionsTitle").innerText =
        currentEventTitle;
      new bootstrap.Modal(document.getElementById("eventOptionsModal")).show();
    },
  });
  calendar.render();

  // These functions MUST exist below for this to work
  loadSchedule(calendar);
  loadRecipes();
});

// --- 3. CORE LOGIC ---
function addRecipe() {
  const name = document.getElementById("recipeName").value;
  const ingredients = document
    .getElementById("recipeIngredients")
    .value.split("\n")
    .filter((l) => l.trim() !== "");
  const instructions = document.getElementById("recipeInstructions").value;
  if (name) {
    db.collection("recipes")
      .add({
        name: name,
        ingredients: ingredients,
        instructions: instructions,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      })
      .then(() => {
        document.getElementById("recipeName").value = "";
        document.getElementById("recipeIngredients").value = "";
        document.getElementById("recipeInstructions").value = "";
      });
  }
}

// UPDATED: Now includes the Share button and triggerShare function call
function loadRecipes() {
  db.collection("recipes")
    .orderBy("createdAt", "desc")
    .onSnapshot((snapshot) => {
      const listDiv = document.getElementById("recipeList");
      listDiv.innerHTML = "";
      snapshot.forEach((doc) => {
        const recipe = doc.data();
        const safeName = recipe.name.replace(/'/g, "\\'");
        listDiv.innerHTML += `
                <div class="list-group-item d-flex justify-content-between align-items-center recipe-item">
                    <span class="fw-bold text-truncate" style="max-width: 140px;" title="${recipe.name}">${recipe.name}</span>
                    <div class="d-flex gap-1">
                        <button class="btn btn-sm btn-outline-info rounded-pill px-2" onclick="triggerShare('${doc.id}')">Share</button>
                        <button class="btn btn-sm btn-outline-primary rounded-pill px-3" onclick="openRecipeModal('${doc.id}')">Cook</button>
                        <button class="btn btn-sm btn-outline-danger rounded-pill" onclick="deleteRecipe('${doc.id}', '${safeName}')">🗑</button>
                    </div>
                </div>`;
      });
    });
}

function loadSchedule(calendar) {
  db.collection("schedule").onSnapshot((snapshot) => {
    calendar.getEvents().forEach((event) => event.remove());
    snapshot.forEach((doc) => {
      const data = doc.data();
      calendar.addEvent({
        id: doc.id,
        title: data.title,
        start: data.date,
        allDay: true,
        backgroundColor: "#198754",
        borderColor: "#198754",
      });
    });
  });
}

// --- 4. SHOPPING LIST ENGINE ---
async function generateShoppingList() {
  const listHtml = document.getElementById("shoppingListItems");
  const selectHtml = document.getElementById("weekSelector");

  if (selectHtml.options.length <= 1)
    listHtml.innerHTML =
      "<li class='list-group-item'>Scanning Schedule...</li>";

  // 1. Get Future Events
  const futureEvents = calendar
    .getEvents()
    .filter((e) => e.start >= new Date().setHours(0, 0, 0, 0));

  // 2. Group by Week
  weeksData = {};
  futureEvents.forEach((event) => {
    const weekStart = getWeekStart(event.start);
    const dateKey = weekStart.toISOString().split("T")[0];
    if (!weeksData[dateKey])
      weeksData[dateKey] = {
        prettyDate: weekStart.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        meals: [],
      };
    weeksData[dateKey].meals.push(event.title.trim().toLowerCase());
  });

  // 3. Fetch Data
  const recipeSnap = await db.collection("recipes").get();
  const recipeMap = {};
  recipeSnap.forEach(
    (doc) =>
      (recipeMap[doc.data().name.toLowerCase()] = doc.data().ingredients || []),
  );

  // 4. Build Dropdown
  const currentSelection = selectHtml.value;
  selectHtml.innerHTML = "";

  Object.keys(weeksData)
    .sort()
    .forEach((dateKey, index) => {
      const option = document.createElement("option");
      option.value = dateKey;
      option.text = `Week of ${weeksData[dateKey].prettyDate}`;
      if (currentSelection === dateKey) option.selected = true;
      else if (!currentSelection && index === 0) option.selected = true;
      selectHtml.add(option);

      weeksData[dateKey].ingredients = [];
      weeksData[dateKey].meals.forEach((m) => {
        if (recipeMap[m]) weeksData[dateKey].ingredients.push(...recipeMap[m]);
      });
    });

  renderSelectedWeek();
}

function renderSelectedWeek() {
  const selectedDateKey = document.getElementById("weekSelector").value;
  const listHtml = document.getElementById("shoppingListItems");

  if (!weeksData[selectedDateKey] || !weeksData[selectedDateKey].ingredients) {
    listHtml.innerHTML = "<li class='list-group-item'>No meals planned.</li>";
    return;
  }

  const ingredients = weeksData[selectedDateKey].ingredients;
  listHtml.innerHTML = "";

  const storageKey = `checked_${selectedDateKey}`;
  const savedChecks = JSON.parse(localStorage.getItem(storageKey)) || [];

  if (ingredients.length > 0) {
    const shoppingMap = {};
    ingredients.forEach((line) => {
      const parsed = parseLine(line);
      const key = `${parsed.name}_${parsed.unit}`;
      shoppingMap[key]
        ? (shoppingMap[key].qty += parsed.qty)
        : (shoppingMap[key] = {
            qty: parsed.qty,
            unit: parsed.unit,
            name: parsed.name,
          });
    });

    Object.keys(shoppingMap)
      .sort()
      .forEach((key) => {
        const item = shoppingMap[key];
        let display =
          item.unit === ""
            ? `${Math.round(item.qty * 100) / 100}x ${capitalize(item.name)}`
            : `${Math.round(item.qty * 100) / 100} ${item.unit} ${capitalize(item.name)}`;

        // KEY FIX: Encode the ID to handle spaces and quotes safely
        const safeKey = encodeURIComponent(key);
        const isChecked = savedChecks.includes(safeKey) ? "checked" : "";

        listHtml.innerHTML += `
                <li class="list-group-item">
                    <input class="form-check-input me-2" type="checkbox" ${isChecked} onchange="toggleCheck('${selectedDateKey}', '${safeKey}')"> 
                    <span>${display}</span>
                </li>`;
      });
  } else
    listHtml.innerHTML =
      "<li class='list-group-item text-danger'>No ingredients found!</li>";
}

// GLOBAL CHECK FUNCTION
window.toggleCheck = function (weekKey, itemKey) {
  const storageKey = `checked_${weekKey}`;
  let savedChecks = JSON.parse(localStorage.getItem(storageKey)) || [];

  if (savedChecks.includes(itemKey)) {
    savedChecks = savedChecks.filter((k) => k !== itemKey);
  } else {
    savedChecks.push(itemKey);
  }
  localStorage.setItem(storageKey, JSON.stringify(savedChecks));
};

// --- HELPERS ---
function saveMealToDate(date, mealName) {
  db.collection("schedule").add({ date: date, title: mealName });
}
function deleteRecipe(id, name) {
  if (confirm("Permanently delete '" + name + "'?"))
    db.collection("recipes").doc(id).delete();
}
function deleteCurrentEvent() {
  if (confirm("Remove meal?"))
    db.collection("schedule")
      .doc(currentEventId)
      .delete()
      .then(() =>
        bootstrap.Modal.getInstance(
          document.getElementById("eventOptionsModal"),
        ).hide(),
      );
}
function openRecipeFromEvent() {
  bootstrap.Modal.getInstance(
    document.getElementById("eventOptionsModal"),
  ).hide();
  db.collection("recipes")
    .where("name", "==", currentEventTitle)
    .get()
    .then((q) => {
      if (!q.empty) openRecipeModal(q.docs[0].id);
    });
}
function openRecipeModal(id) {
  db.collection("recipes")
    .doc(id)
    .get()
    .then((doc) => {
      if (doc.exists) {
        document.getElementById("modalRecipeTitle").innerText = doc.data().name;
        document.getElementById("modalInstructions").innerText =
          doc.data().instructions || "No instructions.";
        document.getElementById("modalIngredients").innerHTML = doc
          .data()
          .ingredients.map((i) => `<li class="list-group-item">${i}</li>`)
          .join("");
        new bootstrap.Modal(document.getElementById("recipeModal")).show();
      }
    });
}
function filterRecipes() {
  const q = document.getElementById("recipeSearch").value.toLowerCase();
  document
    .querySelectorAll(".recipe-item")
    .forEach((i) =>
      i.innerText.toLowerCase().includes(q)
        ? i.classList.replace("d-none", "d-flex")
        : i.classList.replace("d-flex", "d-none"),
    );
}

function copyListToClipboard() {
  const listItems = document.querySelectorAll("#shoppingListItems li");
  const weekSelect = document.getElementById("weekSelector");

  // Safety check for empty list
  if (!weekSelect || weekSelect.selectedIndex < 0) return;

  const weekText = weekSelect.options[weekSelect.selectedIndex].text;
  let text = "🛒 Grocery List for " + weekText + ":\n";
  let found = false;

  listItems.forEach((li) => {
    const cb = li.querySelector("input");
    if (cb && !cb.checked) {
      text += "- " + li.innerText.trim() + "\n";
      found = true;
    }
  });

  if (!found) {
    alert("⚠️ Nothing to copy! (Everything is checked off)");
    return;
  }

  // METHOD 1: Modern API (Try this first)
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard
      .writeText(text)
      .then(() => alert("✅ Copied to Clipboard!"))
      .catch((err) => {
        console.error("Modern copy failed, trying legacy...", err);
        legacyCopy(text);
      });
  } else {
    legacyCopy(text);
  }
}

// METHOD 2: Legacy (The "Bulletproof" Backup)
function legacyCopy(text) {
  // Create a text area INSIDE the modal so it can be focused
  const textArea = document.createElement("textarea");
  textArea.value = text;

  // Make it part of the modal body so it's "visible" to the browser focus
  const modalBody = document.querySelector(".modal-body");
  modalBody.appendChild(textArea);

  // Select and Copy
  textArea.focus();
  textArea.select();

  try {
    const successful = document.execCommand("copy");
    if (successful) alert("✅ Copied (Legacy Mode)!");
    else alert("❌ Browser blocked copy.");
  } catch (err) {
    alert("❌ Copy failed completely.");
  }

  // Clean up
  modalBody.removeChild(textArea);
}

function getWeekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}
function capitalize(str) {
  return str.replace(/\b\w/g, (l) => l.toUpperCase());
}
function parseLine(line) {
  line = line
    .replace(/^[\*\-\•]\s*/, "")
    .trim()
    .toLowerCase();
  const match = line.match(/^(\d+[\/\.]\d+|\d+)\s*/);
  let qty = 1;
  let remainder = line;
  if (match) {
    qty = match[1].includes("/")
      ? parseInt(match[1].split("/")[0]) / parseInt(match[1].split("/")[1])
      : parseFloat(match[1]);
    remainder = line.replace(match[0], "").trim();
  }
  const parts = remainder.split(" ");
  let unit = [
    "cup",
    "cups",
    "tbsp",
    "tsp",
    "oz",
    "lb",
    "lbs",
    "g",
    "kg",
    "ml",
    "l",
    "can",
    "cans",
    "clove",
    "cloves",
    "jar",
    "jars",
    "packet",
    "packets",
  ].includes(parts[0])
    ? parts[0]
    : "";
  if (unit.endsWith("s")) unit = unit.slice(0, -1);
  let name = unit === "" ? remainder : parts.slice(1).join(" ");
  return { qty, unit, name };
}

// --- 5. SHARE ENGINE ---

// NEW: Fetches the recipe from the database and sends it to the Share engine
function triggerShare(id) {
  db.collection("recipes")
    .doc(id)
    .get()
    .then((doc) => {
      if (doc.exists) {
        const data = doc.data();
        const name = data.name;

        // Format ingredients nicely with bullet points
        const ingredients = data.ingredients.map((i) => "- " + i).join("\n");
        const instructions = data.instructions || "No instructions provided.";

        shareRecipe(name, ingredients, instructions);
      }
    });
}

// NEW: Function to handle sharing a recipe
async function shareRecipe(name, ingredients, instructions) {
  // Format the text to look nice in a text message
  const shareText = `🍳 ${name}\n\n🛒 Ingredients:\n${ingredients}\n\n📝 Instructions:\n${instructions}`;

  // Check if the device supports the native sharing menu (like mobile phones do)
  if (navigator.share) {
    try {
      await navigator.share({
        title: name,
        text: shareText,
      });
    } catch (error) {
      console.log("Sharing canceled or failed:", error);
    }
  } else {
    // Fallback for desktop browsers: Copy to clipboard instead
    navigator.clipboard
      .writeText(shareText)
      .then(() => {
        alert("Recipe copied to clipboard! You can now paste it anywhere.");
      })
      .catch((err) => {
        console.error("Failed to copy text: ", err);
      });
  }
}
