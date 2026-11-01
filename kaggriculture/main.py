"""Kaggriculture agents. Self-contained so this file can be submitted as-is.

`agent` (the last function in the file) is the competition entry. STRATEGIES holds
every strategy the app compares. All agents are stateless: each decision comes from
the current observation only.
"""
import math

CROPS = {
    "WHEAT": {"seed": 10, "ripe": 4, "units": 4, "ongoing": False},
    "CARROT": {"seed": 20, "ripe": 3, "units": 3, "ongoing": False},
    "MELON": {"seed": 80, "ripe": 10, "units": 6, "ongoing": False},
    "TOMATO": {"seed": 50, "ripe": 11, "units": 4, "ongoing": True, "first": 8, "last": 11},
    "STRAWBERRY": {"seed": 100, "ripe": 16, "units": 4, "ongoing": True, "first": 10, "last": 16},
}
ANIMALS = {
    "GOOSE": {"cost": 300, "structure": "COOP", "first": 4, "interval": 1, "product": "EGG", "cared": 2.0},
    "COW": {"cost": 400, "structure": "PASTURE", "first": 8, "interval": 2, "product": "MILK", "cared": 1.5},
    "SHEEP": {"cost": 500, "structure": "PASTURE", "first": 6, "interval": 3, "product": "WOOL", "cared": 4 / 3},
}
LAND_PRICES = [1000, 2000, 4000]
SHOPS = {
    "BAKERY": ["EGG", "WHEAT"],
    "PIZZA_SHOP": ["MILK", "TOMATO", "WHEAT"],
    "BRUNCH_SPOT": ["EGG", "WHEAT", "STRAWBERRY"],
    "YARN_STORE": ["WOOL", "WOOL"],
    "ICE_CREAM_SHOP": ["STRAWBERRY", "MILK", "WHEAT"],
    "PET_CAFE": ["CARROT", "CARROT"],
    "SMOOTHIE_SHOP": ["STRAWBERRY", "MILK"],
    "FARMERS_MARKET": ["WHEAT", "CARROT", "TOMATO", "STRAWBERRY"],
}
BASE_PRICE = {"WHEAT": 25, "CARROT": 35, "TOMATO": 60, "STRAWBERRY": 120, "MELON": 250,
              "EGG": 50, "MILK": 160, "WOOL": 200, "FERTILIZER": 100}
# (T, above-I0 shape, above target), matching the published price table.
GLUT_CURVE = {"WHEAT": (400, "log", 0.20), "CARROT": (450, "sqrt", 0.70), "TOMATO": (200, "sqrt", 0.60),
              "STRAWBERRY": (100, "linear", 1.60), "MELON": (300, "sq", 3.60), "EGG": (332, "log", 0.20),
              "MILK": (122, "linear", 1.60), "WOOL": (105, "sq", 3.20), "FERTILIZER": (200, "linear", 0.40)}
I0 = 10000
SEASON_DAYS = 30
TURNS_PER_DAY = 24
HIRE_COST = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987]
SHED_TILES = [(4, 4), (5, 4), (4, 5), (5, 5)]
SHED_LIMIT = 80
TILES_PER_WORKER = 8  # Tiles one unit can keep alive per day, allowing for walking.
LAST_ACTION_HOUR = 22  # The season's final recorded action is at step 718.
PASS_ACTION = {"farmer": ["PASS"], "hands": [], "market": []}


def glut_price(item, inventory, current):
    """Estimated sale price if market inventory moved to `inventory`."""
    if inventory <= I0:
        return float(current)
    T, shape, target = GLUT_CURVE[item]
    x = inventory - I0
    if shape == "log":
        f = math.log1p(x) / math.log1p(T)
    elif shape == "sqrt":
        f = math.sqrt(x / T)
    elif shape == "sq":
        f = (x / T) ** 2
    else:
        f = x / T
    return max(1.0, BASE_PRICE[item] * (1 - target * f))


def town_drain_per_day(item, shops):
    drain = 0.0 if item == "FERTILIZER" else 1.0
    for shop in shops:
        drain += 6 * SHOPS.get(shop, []).count(item)
    return drain


def manhattan(ax, ay, bx, by):
    return abs(ax - bx) + abs(ay - by)


def nearest_shed(x, y):
    return min(SHED_TILES, key=lambda t: manhattan(x, y, t[0], t[1]))


def step_toward(x, y, tx, ty):
    if x < tx:
        return ["EAST"]
    if x > tx:
        return ["WEST"]
    if y < ty:
        return ["SOUTH"]
    if y > ty:
        return ["NORTH"]
    return ["PASS"]


class Planner:
    """Shared farm logistics. Strategies differ only in the parameters given here."""

    def __init__(self, crops=(), animals=(), max_animals=0, max_hands=8, max_land=3,
                 land_cash=1.25, reserve_price=0.0, market_aware=False):
        self.crops = tuple(crops)
        self.animals = tuple(animals)
        self.max_animals = max_animals
        self.max_hands = max_hands
        self.max_land = max_land
        self.land_cash = land_cash
        self.reserve_price = reserve_price
        self.market_aware = market_aware

    def __call__(self, obs):
        me = obs["player"]
        farm = obs["farms"][me]
        private = obs["private"]
        step = obs.get("step", 0) or 0
        day = step // TURNS_PER_DAY
        hour = step % TURNS_PER_DAY
        days_left = SEASON_DAYS - 1 - day
        final_day = days_left == 0
        ctx = {"day": day, "hour": hour, "days_left": days_left, "final_day": final_day,
               "obs": obs, "farm": farm, "private": private, "me": me}

        tasks, unfed, unplaced = self._tile_tasks(farm, ctx)
        ctx["herd"] = sum(1 for row in farm["tiles"] for t in row if isinstance(t, dict) and "animal" in t)
        pipeline = self._pipeline(obs, private, day)
        plan = self._plan_empty_tiles(farm, private, ctx, pipeline)
        for x, y, op in plan["ready"]:
            tasks.append((x, y, op, 2, None))

        units = self._assign(tasks, unfed, unplaced, farm, private, ctx)
        market = self._market(farm, private, ctx, tasks, plan, unfed)
        return {"farmer": units[0], "hands": units[1:], "market": market}

    # ---- Reading the farm ------------------------------------------------

    def _tile_tasks(self, farm, ctx):
        day, final_day = ctx["day"], ctx["final_day"]
        tasks = []
        unfed = 0
        unplaced = {}
        for y, row in enumerate(farm["tiles"]):
            for x, tile in enumerate(row):
                if tile is None or tile == "LOCKED":
                    continue
                kind = tile.get("kind")
                if kind == "WEED":
                    if ctx["days_left"] > 2:
                        tasks.append((x, y, ["DIG"], 4, None))
                elif kind == "PLANT":
                    self._plant_tasks(tasks, x, y, tile, day, final_day)
                elif "animal" in tile:
                    if tile.get("yield_units", 0) > 0:
                        tasks.append((x, y, ["HARVEST"], 1, None))
                    if tile.get("fertilizer_available"):
                        tasks.append((x, y, ["COLLECT_FERTILIZER"], 1, None))
                    if not final_day:
                        if not tile.get("fed_today"):
                            unfed += 1
                            tasks.append((x, y, ["FEED"], 0, "WHEAT"))
                        elif not tile.get("cared_today"):
                            tasks.append((x, y, ["CARE"], 2, None))
                elif kind in ("COOP", "PASTURE") and not final_day:
                    wanted = "GOOSE" if kind == "COOP" else self._pasture_animal()
                    if wanted:
                        unplaced[wanted] = unplaced.get(wanted, 0) + 1
                        tasks.append((x, y, ["PLACE", wanted], 0, wanted))
        return tasks, unfed, unplaced

    def _pasture_animal(self):
        for animal in self.animals:
            if ANIMALS[animal]["structure"] == "PASTURE":
                return animal
        return None

    def _plant_tasks(self, tasks, x, y, tile, day, final_day):
        crop = CROPS[tile["crop"]]
        age = day - tile["planted_day"]
        watered = tile["watered_today"]
        units = tile.get("yield_units", 0)
        if crop["ongoing"]:
            if units > 0 and (units >= 2 or age >= crop["last"] or final_day):
                tasks.append((x, y, ["HARVEST"], 1, None))
            elif units == 0 and age > crop["last"]:
                tasks.append((x, y, ["DIG"], 3, None))
            elif not watered and not final_day:
                tasks.append((x, y, ["WATER"], 0, None))
            return
        if not watered and age <= crop["ripe"] and not final_day:
            tasks.append((x, y, ["WATER"], 0, None))
        elif age >= crop["ripe"] or (final_day and units > 0):
            tasks.append((x, y, ["HARVEST"], 1, None))
        elif not watered and final_day:
            tasks.append((x, y, ["WATER"], 0, None))

    def _pipeline(self, obs, private, day):
        """Units of each product already on their way to the shared market."""
        days_left = max(0, SEASON_DAYS - 1 - day)
        pipeline = {item: 0.0 for item in BASE_PRICE}
        for item, n in private["shed"].items():
            if item in pipeline:
                pipeline[item] += n
        for farm in obs["farms"]:
            for row in farm["tiles"]:
                for tile in row:
                    if not isinstance(tile, dict):
                        continue
                    if tile.get("kind") == "PLANT":
                        cd = CROPS[tile["crop"]]
                        pipeline[tile["crop"]] += cd["units"]
                    elif "animal" in tile:
                        a = ANIMALS[tile["animal"]]
                        pipeline[a["product"]] += a["cared"] * days_left * 0.5
                        pipeline["FERTILIZER"] += days_left * 0.5
        return pipeline

    # ---- Deciding what to put on empty tiles ------------------------------

    def _expected_price(self, item, ctx, pipeline, horizon, extra=0.0):
        market = ctx["obs"]["market"]
        shops = ctx["obs"]["town"]["unlocked_shops"]
        inventory = market["inventory"][item] + pipeline[item] + extra
        inventory -= town_drain_per_day(item, shops) * horizon
        return glut_price(item, inventory, market["prices"][item])

    def _crop_value(self, name, ctx, pipeline, held_seeds):
        """Net coins per tile-day for planting `name` now, or None if it cannot finish."""
        cd = CROPS[name]
        if ctx["days_left"] < cd["ripe"]:
            return None
        if self.market_aware:
            price = self._expected_price(name, ctx, pipeline, cd["ripe"], cd["units"] / 2)
        else:
            price = BASE_PRICE[name]
        seed_cost = 0 if held_seeds > 0 else cd["seed"]
        return (cd["units"] * price - seed_cost) / (cd["ripe"] + 1)

    def _animal_value(self, name, ctx, pipeline):
        a = ANIMALS[name]
        producing = ctx["days_left"] - a["first"]
        if producing <= 2:
            return None
        if self.market_aware:
            product = self._expected_price(a["product"], ctx, pipeline, ctx["days_left"] / 2)
            fertilizer = self._expected_price("FERTILIZER", ctx, pipeline, ctx["days_left"] / 2)
            wheat = ctx["obs"]["market"]["prices"]["WHEAT"] + 4
        else:
            product, fertilizer, wheat = BASE_PRICE[a["product"]], BASE_PRICE["FERTILIZER"], 30
        income = producing * a["cared"] * product + ctx["days_left"] * (fertilizer - wheat)
        return (income - a["cost"]) / ctx["days_left"]

    def _plan_empty_tiles(self, farm, private, ctx, pipeline):
        """Choose a use for each empty tile, nearest the shed first."""
        result = {"ready": [], "buy_seed": {}, "buy_animal": {}, "spend": 0.0, "empties": 0}
        if ctx["final_day"]:
            return result
        empties = []
        animals_now = 0
        structures = 0
        active = 0
        for y, row in enumerate(farm["tiles"]):
            for x, tile in enumerate(row):
                if tile is None:
                    empties.append((manhattan(x, y, 4.5, 4.5), x, y))
                elif isinstance(tile, dict) and "animal" in tile:
                    animals_now += 1
                    active += 2
                elif isinstance(tile, dict) and tile.get("kind") in ("COOP", "PASTURE"):
                    structures += 1
                elif isinstance(tile, dict) and tile.get("kind") == "PLANT":
                    active += 1
        empties.sort()
        result["empties"] = len(empties)
        if ctx["hour"] > 19:
            return result  # A seed planted now might miss today's watering and die.
        seeds = dict(private["seeds"])
        pipeline = dict(pipeline)
        hands_needed = min(self.max_hands, 3 + active // TILES_PER_WORKER)
        budget = farm["money"] - sum(HIRE_COST[:hands_needed]) - ctx["herd"] * 50
        stock = {a: private["shed"].get(a, 0) + sum(inv.get(a, 0) for inv in private["inventories"])
                 for a in ANIMALS}
        spare = dict(stock)
        for row in farm["tiles"]:
            for tile in row:
                if isinstance(tile, dict) and tile.get("kind") in ("COOP", "PASTURE") and "animal" not in tile:
                    for a in ANIMALS:
                        if ANIMALS[a]["structure"] == tile["kind"] and spare[a] > 0:
                            spare[a] -= 1
                            break
        herd = animals_now + structures + sum(spare.values())
        capacity = (1 + self.max_hands) * TILES_PER_WORKER
        for _, x, y in empties:
            if active >= capacity:
                break
            best, best_value = None, 0.0
            for name in self.crops:
                value = self._crop_value(name, ctx, pipeline, seeds.get(name, 0))
                if value is not None and value > best_value:
                    best, best_value = name, value
            if herd < self.max_animals:
                for name in self.animals:
                    value = self._animal_value(name, ctx, pipeline)
                    if value is not None and value > best_value:
                        best, best_value = name, value
            if best is None:
                continue
            if best in ANIMALS:
                a = ANIMALS[best]
                if spare[best] > 0:
                    # Already bought: give it somewhere to live.
                    spare[best] -= 1
                    build = "BUILD_COOP" if a["structure"] == "COOP" else "BUILD_PASTURE"
                    result["ready"].append((x, y, [build]))
                elif budget >= a["cost"]:
                    budget -= a["cost"]
                    result["spend"] += a["cost"]
                    result["buy_animal"][best] = result["buy_animal"].get(best, 0) + 1
                else:
                    continue
                herd += 1
                active += 2
                pipeline[a["product"]] += a["cared"] * ctx["days_left"] * 0.5
                pipeline["FERTILIZER"] += ctx["days_left"] * 0.5
                continue
            cd = CROPS[best]
            pipeline[best] += cd["units"]
            active += 1
            if seeds.get(best, 0) > 0:
                seeds[best] -= 1
                result["ready"].append((x, y, ["PLANT", best]))
            elif budget >= cd["seed"]:
                budget -= cd["seed"]
                result["spend"] += cd["seed"]
                result["buy_seed"][best] = result["buy_seed"].get(best, 0) + 1
        return result

    # ---- Moving workers ---------------------------------------------------

    def _assign(self, tasks, unfed, unplaced, farm, private, ctx):
        positions = [farm["farmer"]] + list(farm["hands"])
        inventories = private["inventories"]
        taken = set()
        shed = dict(private["shed"])
        need = {"WHEAT": unfed, **unplaced}
        for inv in inventories:
            for item in need:
                need[item] -= inv.get(item, 0)
        actions = []
        for index, (x, y) in enumerate(positions):
            inv = inventories[index] if index < len(inventories) else {}
            actions.append(self._unit_action(x, y, inv, tasks, taken, shed, need, ctx))
        return actions

    def _unit_action(self, x, y, inv, tasks, taken, shed, need, ctx):
        # On the last day everything must reach the shed in time to be sold.
        if ctx["final_day"] and ctx["hour"] >= LAST_ACTION_HOUR - 6:
            if any(n > 0 for n in inv.values()):
                sx, sy = nearest_shed(x, y)
                return ["DROP"] if (x, y) == (sx, sy) else step_toward(x, y, sx, sy)

        best, best_score = None, 1e9
        for i, (tx, ty, op, priority, requires) in enumerate(tasks):
            if i in taken or (requires and inv.get(requires, 0) <= 0):
                continue
            score = manhattan(x, y, tx, ty) + priority * 3
            if score < best_score:
                best, best_score = i, score

        sx, sy = nearest_shed(x, y)
        fetch, fetch_score = None, 1e9
        for item, wanted in need.items():
            if wanted > 0 and shed.get(item, 0) > 0 and inv.get(item, 0) <= 0:
                score = manhattan(x, y, sx, sy)
                if score < fetch_score:
                    fetch, fetch_score = item, score

        if fetch is not None and fetch_score < best_score:
            amount = min(shed[fetch], need[fetch], 6 if fetch == "WHEAT" else 2)
            shed[fetch] -= amount
            need[fetch] -= amount
            if (x, y) == (sx, sy):
                return ["PICKUP", fetch, amount]
            return step_toward(x, y, sx, sy)

        if best is None:
            return ["PASS"]
        taken.add(best)
        tx, ty, op, _, requires = tasks[best]
        if (x, y) == (tx, ty):
            if requires:
                inv[requires] = inv.get(requires, 0) - 1
            return list(op)
        return step_toward(x, y, tx, ty)

    # ---- Market orders ----------------------------------------------------

    def _market(self, farm, private, ctx, tasks, plan, unfed):
        orders = self._sell_orders(private, ctx)
        money = farm["money"]
        if not ctx["final_day"]:
            orders += self._hire_orders(farm, ctx, tasks)
            wheat = private["shed"].get("WHEAT", 0)
            if unfed > wheat and ctx["hour"] < 20:
                orders.append(["BUY_PRODUCT", "WHEAT", min(unfed - wheat, 40)])
            for animal, n in plan["buy_animal"].items():
                orders.append(["BUY_ANIMAL", animal, n])
            for crop, n in plan["buy_seed"].items():
                orders.append(["BUY_SEED", crop, n])
            orders += self._land_orders(farm, ctx, money - plan["spend"], plan["empties"])
        return orders[:10]

    def _sell_orders(self, private, ctx):
        market = ctx["obs"]["market"]
        shed = private["shed"]
        stock = sum(shed.values())
        floor_share = self.reserve_price * min(1.0, ctx["days_left"] / 6)
        orders = []
        for item in BASE_PRICE:
            have = shed.get(item, 0)
            if have <= 0:
                continue
            if item == "WHEAT" and not ctx["final_day"]:
                have -= min(have, ctx["herd"] * 2)  # Keep feed for tomorrow.
                if have <= 0:
                    continue
            floor = BASE_PRICE[item] * floor_share
            overflow = max(0, stock - SHED_LIMIT)
            n = 0
            inventory = market["inventory"][item]
            while n < have:
                price = glut_price(item, inventory + n, market["prices"][item])
                if price < floor and n >= overflow:
                    break
                n += 1
            if n > 0:
                orders.append(["SELL", item, n])
                stock -= n
        return orders

    def _hire_orders(self, farm, ctx, tasks):
        if ctx["hour"] > 16:
            return []
        workload = len(tasks) * 2.2
        turns = max(1, TURNS_PER_DAY - ctx["hour"] - 2)
        wanted = min(self.max_hands, int(math.ceil(workload / turns)) - 1)
        hired = farm["hires_today"]
        orders = []
        while hired < wanted and len(orders) < 4:
            orders.append(["HIRE"])
            hired += 1
        return orders

    def _land_orders(self, farm, ctx, cash, empties):
        owned = len(farm["unlocked_quadrants"]) - 1
        if owned >= min(self.max_land, len(LAND_PRICES)) or ctx["days_left"] < 12 or empties > 4:
            return []
        if cash >= LAND_PRICES[owned] * self.land_cash:
            return [["BUY_LAND"]]
        return []


def wheat_loop(obs):
    """The worked example from the competition guide, with a farmer and one tile."""
    me = obs["farms"][obs["player"]]
    private = obs["private"]
    fx, fy = me["farmer"]
    tile = me["tiles"][fy][fx]
    day = (obs.get("step", 0) or 0) // TURNS_PER_DAY
    market = []
    if private["seeds"].get("WHEAT", 0) == 0 and me["money"] >= 10:
        market.append(["BUY_SEED", "WHEAT", 1])
    wheat = private["shed"].get("WHEAT", 0)
    if wheat > 0:
        market.append(["SELL", "WHEAT", wheat])
    if tile is None and private["seeds"].get("WHEAT", 0) > 0:
        return {"farmer": ["PLANT", "WHEAT"], "hands": [], "market": market}
    if isinstance(tile, dict) and tile.get("kind") == "PLANT":
        if not tile["watered_today"]:
            return {"farmer": ["WATER"], "hands": [], "market": market}
        if day - tile["planted_day"] >= 4:
            return {"farmer": ["HARVEST"], "hands": [], "market": market}
    return {"farmer": ["PASS"], "hands": [], "market": market}


STRATEGIES = {
    "wheat_loop": wheat_loop,
    "staple_fields": Planner(crops=("WHEAT", "CARROT"), max_hands=9, market_aware=True),
    "melon_rush": Planner(crops=("MELON",), max_hands=8, reserve_price=0.15),
    "goose_ranch": Planner(crops=("WHEAT",), animals=("GOOSE",), max_animals=30, max_hands=13),
    "mixed_ranch": Planner(crops=("WHEAT", "CARROT"), animals=("GOOSE", "COW"), max_animals=40,
                           max_hands=13, market_aware=True),
    "market_planner": Planner(crops=("WHEAT", "CARROT", "MELON", "TOMATO", "STRAWBERRY"),
                              animals=("GOOSE", "COW"), max_animals=30, max_hands=13,
                              reserve_price=0.15, market_aware=True),
}


def agent(obs):
    """Competition entry point."""
    return STRATEGIES["market_planner"](obs)
