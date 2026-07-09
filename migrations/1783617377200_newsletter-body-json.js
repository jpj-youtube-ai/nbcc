/* eslint-disable */
// TASK-168 (REQ-069): the newsletter block document. Additive/expand-contract: one new nullable
// column on `newsletters`, no existing column dropped or narrowed (body_html is retained as the
// compiled render + immutable record). Converts the single seeded starter draft into a starter
// block document so the new builder demos on first load. Safe under a code-level rollback.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("newsletters", {
    body_json: { type: "jsonb" }, // NULL for legacy raw-HTML drafts; the block document otherwise
  });

  // Convert the starter seed (subject unchanged) into a minimal block document.
  pgm.sql(`
    UPDATE newsletters
       SET body_json = '{"blocks":[
             {"type":"masthead","variant":0,"data":{"issueTitle":"Newsletter"}},
             {"type":"greeting","variant":0,"data":{}},
             {"type":"text","variant":0,"data":{"text":"Write your update here."}},
             {"type":"donationCta","variant":3,"data":{"heading":"Support our work","label":"Make a donation today","href":"https://nbcc.scot/donate"}}
           ]}'::jsonb
     WHERE subject = 'North Berwick Christmas Committee — Newsletter'
       AND status = 'draft'
       AND body_json IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.dropColumn("newsletters", "body_json");
};
