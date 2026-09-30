import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// TASK-474: an Infra apply that changes the task definition leaves the family's latest revision on
// Terraform's placeholder image (nginx). The scheduled jobs (the 8am reminders, which send the Ball
// ticket report, and the 2am backup) run the family's latest, so the workflow re-registers that
// revision on the image the service is running. These pin the step's shape; it only runs on a real
// apply, which no test can do.

const workflow = readFileSync(resolve(__dirname, "../../.github/workflows/infra.yml"), "utf8");
const step = workflow.slice(workflow.indexOf("- name: Keep the scheduled jobs on the running app image"));

describe("the Infra workflow keeps the scheduled jobs on the app's image", () => {
  it("has the step, after the apply, and runs it only on an apply", () => {
    expect(workflow.indexOf("terraform apply")).toBeGreaterThan(-1);
    expect(workflow.indexOf("- name: Keep the scheduled jobs")).toBeGreaterThan(workflow.indexOf("terraform apply"));
    expect(step).toContain("if: inputs.action == 'apply'");
  });

  it("takes the image the service is running, and Terraform's own revision for everything else", () => {
    expect(step).toContain("aws ecs describe-services");
    expect(step).toContain("terraform output -raw task_definition_arn");
    expect(step).toContain(".containerDefinitions[0].image = $IMG");
    expect(step).toContain("aws ecs register-task-definition");
  });

  it("does nothing on a first apply, and never changes what the service runs", () => {
    expect(step).toMatch(/\*nginx\*\)[\s\S]*exit 0/);
    expect(step).not.toContain("update-service");
  });
});
