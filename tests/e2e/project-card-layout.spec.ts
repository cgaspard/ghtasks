import { test, expect } from "./fixtures/app";
import {
  PROJECT_ITEMS,
  PROJECT_PAGE_EVENT,
  PROJECT_SOURCE,
  PROJECT_SUMMARY,
  STATUS_FIELD,
} from "./fixtures/mockData";

test.describe("Projects card layout", () => {
  test.use({ viewport: { width: 480, height: 560 } });

  test("Expanded preserves flat cards; Compact groups multiple items and persists", async ({ mountApp, page }) => {
    await mountApp();
    await expect(page.locator("ul.issues > li.issue")).toHaveCount(5);
    await expect(page.locator(".status-group")).toHaveCount(0);
    await expect(page.locator("li.issue").filter({ hasText: "Fix the login flow" }).locator(".row3")).toContainText("v1.0");

    await page.getByRole("button", { name: "Compact", exact: true }).click();
    const todo = page.getByRole("region", { name: "Todo", exact: true });
    await expect(todo.locator(".short-issue")).toHaveCount(2);
    await expect(page.getByRole("region", { name: "No Status", exact: true }).locator(".short-issue")).toHaveCount(1);
    await expect(page.locator("ul.issues")).toHaveCount(0);

    const row = todo.locator(".short-issue").filter({ hasText: "Add dark mode toggle" });
    const title = row.locator(".short-title");
    expect(await title.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe("nowrap");
    await expect(title).toHaveAttribute("title", /Add dark mode toggle.*#101/);

    await page.reload();
    await expect(page.getByRole("button", { name: "Compact", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".short-issue")).toHaveCount(5);
    await page.getByRole("button", { name: "Expanded", exact: true }).click();
    await expect(page.locator("ul.issues > li.issue")).toHaveCount(5);
    await expect(page.locator(".status-group")).toHaveCount(0);
  });

  test("collapsed groups survive the layout toggle; status changes open the destination", async ({ mountApp, page }) => {
    await mountApp();
    await page.getByRole("button", { name: "Compact", exact: true }).click();
    const done = page.getByRole("region", { name: "Done", exact: true });
    await done.locator(".group-heading").click();
    await expect(done.locator("ul")).toBeHidden();
    await page.getByRole("button", { name: "Expanded", exact: true }).click();
    await page.getByRole("button", { name: "Compact", exact: true }).click();
    await expect(done.locator("ul")).toBeHidden();

    await page.getByRole("button", { name: "Change status for Add dark mode toggle", exact: true }).click();
    await page.getByRole("menu").getByRole("menuitemradio", { name: "Done", exact: true }).click();
    await expect(done.locator("ul")).toBeVisible();
    await expect(done.locator(".short-issue")).toHaveCount(2);
    await expect(page.getByRole("region", { name: "Todo", exact: true }).locator(".short-issue")).toHaveCount(1);
    await expect(done.getByRole("button", { name: "Change status for Add dark mode toggle", exact: true })).toBeFocused();

    await page.getByRole("button", { name: "Expanded", exact: true }).click();
    await expect(page.locator("li.issue").filter({ hasText: "Add dark mode toggle" }).getByText("Done", { exact: true })).toBeVisible();
  });

  test("a rejected status change returns the item to its original bucket", async ({ mountApp, page }) => {
    await mountApp({ errors: { set_project_item_status: "GitHub is unavailable" } });
    await page.getByRole("button", { name: "Compact", exact: true }).click();
    await page.getByRole("button", { name: "Change status for Add dark mode toggle", exact: true }).click();
    await page.getByRole("menu").getByRole("menuitemradio", { name: "Done", exact: true }).click();
    await expect(page.getByRole("region", { name: "Todo", exact: true }).locator(".short-issue")).toHaveCount(2);
    await expect(page.getByRole("region", { name: "Done", exact: true }).locator(".short-issue")).toHaveCount(1);
    await expect(page.getByRole("alert")).toContainText("GitHub is unavailable");
  });

  test("separate project workflows and unknown statuses remain distinct", async ({ mountApp, page }) => {
    const secondSource = { ...PROJECT_SOURCE, id: "src-proj-2", name: "Delivery" };
    const secondStatus = { ...STATUS_FIELD, id: "FIELD_delivery", options: [
      { id: "READY", name: "Todo", color: "BLUE" },
      { id: "SHIPPING", name: "Shipping", color: "PURPLE" },
    ] };
    const secondItems = PROJECT_ITEMS.slice(0, 2).map((item, index) => ({
      ...item,
      item_id: `DELIVERY_${index}`,
      issue: { ...item.issue, title: `Delivery ${index + 1}`, node_id: `DELIVERY_NODE_${index}` },
      field_values: [{ field_id: secondStatus.id, field_name: "Status", data_type: "SINGLE_SELECT", option_id: index ? "OLD_OPTION" : "READY", text: index ? "Legacy review" : "Todo" }],
    }));
    await mountApp({
      sources: [PROJECT_SOURCE, secondSource],
      projectPages: [PROJECT_PAGE_EVENT, { ...PROJECT_PAGE_EVENT, source_id: secondSource.id, project: { ...PROJECT_SUMMARY, id: "PVT_delivery", title: "Delivery" }, fields: [secondStatus], items: secondItems }],
    });
    await page.getByRole("button", { name: "Compact", exact: true }).click();
    await expect(page.getByRole("region", { name: "Roadmap: Todo", exact: true }).locator(".short-issue")).toHaveCount(2);
    const deliveryTodo = page.getByRole("region", { name: "Delivery: Todo", exact: true });
    await expect(deliveryTodo.locator(".short-issue")).toHaveCount(1);
    expect(await deliveryTodo.locator(".group-dot").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(79, 140, 255)");
    await expect(page.getByRole("region", { name: "Delivery: Legacy review", exact: true })).toContainText("Delivery 2");
    await expect(page.getByRole("region", { name: "Roadmap: No Status", exact: true })).toBeVisible();
  });
});
