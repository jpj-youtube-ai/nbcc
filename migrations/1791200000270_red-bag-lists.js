/* eslint-disable camelcase */

// Fill a Red Bag: staff can edit the list (the items, their prices, the "Whenever the need comes"
// examples) in Admin > Fill a Red Bag, as a draft, and publish it. Two things, both additive.
//
// 1. A NEW TABLE, red_bag_lists. A row is a whole list (data, as src/red-bag/list.ts describes it):
//
//      status 'draft'      the ONE shared draft. The partial unique index allows one at most.
//                          `version` is its stamp: it moves on by one with every save, and a save,
//                          publish or throw away sent against an older stamp is refused.
//      status 'published'  a list that was published, kept for ever: the history. The website's
//                          list is the one with the latest published_at. `summary` and `changes`
//                          say, in plain words, what it changed when it was published.
//
//    Publishing turns the draft's own row into a published one, so the next save starts a new
//    draft. restored_from / restored_original say where a draft was put back from, if it was.
//
//    NO ROW IS SEEDED. With nothing published, /fill uses the list written in
//    assets/js/red-bag-catalogue.js exactly as it did before this migration: running it changes
//    nothing on the public page until somebody publishes.
//
// 2. THE NEW ACCESS SECTION "red-bag" (src/admin/permissions.ts), written into the access already
//    saved. This is the rule since TASK-406, in the TASK-479 shape
//    (1791000000001_permissions-analytics.js): a stored matrix is a complete statement of access,
//    so a section it does not name is denied, admins included. Without this an admin whose access
//    was ever saved could not open the new screen. The values are what roleToPermissions gives
//    each role, and test/unit/red-bag-lists-migration.test.ts holds them to it:
//
//      red-bag  admin edit, editor none, anyone else none
//
//    It only ADDS the key to matrices that lack it. A user with no stored matrix is untouched
//    (they already fall through to their role's defaults), and no other key is read or written.
//    Every key it adds is recorded in audit_log as admin_user.permissions_backfilled, by
//    migration:red-bag-lists, with the section and level. It is in this file, not one of its own,
//    so the screen and the access to it can never arrive apart.

const PERMISSIONS_BACKFILL = `
    WITH added AS (
      UPDATE users
         SET permissions = permissions || jsonb_build_object(
               'red-bag',
               CASE role WHEN 'admin' THEN 'edit' WHEN 'editor' THEN 'none' ELSE 'none' END
             )
       WHERE permissions IS NOT NULL
         AND permissions <> '{}'::jsonb
         AND NOT (permissions ? 'red-bag')
      RETURNING id, permissions->>'red-bag' AS level
    )
    INSERT INTO audit_log (actor, action, entity, entity_id, data)
    SELECT 'migration:red-bag-lists', 'admin_user.permissions_backfilled', 'user', id,
           jsonb_build_object('section', 'red-bag', 'level', level)
      FROM added
  `;

exports.PERMISSIONS_BACKFILL = PERMISSIONS_BACKFILL;

exports.up = (pgm) => {
  pgm.createTable("red_bag_lists", {
    id: "id",
    status: { type: "text", notNull: true, check: "status IN ('draft', 'published')" },
    data: { type: "jsonb", notNull: true, comment: "The whole list: { v, items, examples }. See src/red-bag/list.ts." },
    version: { type: "integer", notNull: true, default: 1, comment: "The draft's stamp: one more with every save." },
    summary: { type: "text", comment: "Published rows: one line saying what it changed." },
    changes: { type: "jsonb", notNull: true, default: "[]", comment: "Published rows: every change, in plain words." },
    restored_from: { type: "integer", references: "red_bag_lists", comment: "The published list this was put back from, if it was." },
    restored_original: { type: "boolean", notNull: true, default: false, comment: "Put back from the list written in the code." },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    created_by: { type: "text" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "text" },
    updated_by_name: { type: "text" },
    published_at: { type: "timestamptz" },
    published_by: { type: "text" },
    published_by_name: { type: "text" },
  });
  // One draft at most: only drafts are in this index, and they all share the one value.
  pgm.createIndex("red_bag_lists", "status", { name: "red_bag_lists_one_draft", unique: true, where: "status = 'draft'" });
  // The website's list is the one published last.
  pgm.createIndex("red_bag_lists", [{ name: "published_at", sort: "DESC" }], { name: "red_bag_lists_published", where: "status = 'published'" });
  pgm.addConstraint("red_bag_lists", "red_bag_lists_published_when", { check: "status <> 'published' OR published_at IS NOT NULL" });

  pgm.sql(PERMISSIONS_BACKFILL);
};

// Drops its own table. The access keys are deliberately left, like the earlier backfills': once the
// screen exists, a saved matrix naming it may be somebody's choice. To take access away, use
// Team > Manage access.
exports.down = (pgm) => {
  pgm.dropTable("red_bag_lists");
};
