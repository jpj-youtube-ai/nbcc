import { escapeHtml } from "./page";
import { choosableCourses, fixedCourses, type MenuCourse } from "./menu";
import { ballEmailShell, contactPanel, BALL_TEXT_FOOTER } from "./email-shell";
import { SLATE, SLATE_SOFT, TAN_SOFT, HEAD, BODY_FONT, CRIMSON, MAROON } from "../email/brand";

// TASK-418: "the venue has confirmed the menu, come and choose".
//
// Until now nobody who had already booked was ever told a menu existed. The guest link sat in a
// confirmation email from weeks earlier, and the menu appeared behind it silently. Somebody who
// had already filled in their guests had no reason to go back, so the kitchen would have got a
// table of names with no dinners against them.
//
// Sent only when staff press the button in admin. There is no scheduler in this app, and a cron
// misfiring at 3am against four hundred people is a worse failure than a button somebody has to
// press. Idempotency lives in the query (menu_email_sent_at IS NULL), exactly as the week-to-go
// reminder does it.
//
// Pure: no pool, no config, no clock, so it is unit-tested DB-free like every other ball email.

export interface MenuReadyInput {
  buyerFirstName: string;
  reference: string;
  guestLink: string;
  menu: MenuCourse[];
  menuNote: string | null;
}

export interface MenuReadyEmail {
  subject: string;
  html: string;
  text: string;
}

const P = `style="color:${SLATE};font-family:${BODY_FONT};font-size:14px;line-height:1.6;margin:0 0 12px"`;
const SMALL = `style="color:${SLATE_SOFT};font-family:${BODY_FONT};font-size:13px;line-height:1.55;margin:0 0 10px"`;

// The menu, laid out as a menu rather than as a list of form options. This email exists to be
// READ: "the menu is ready, click here to see it" is a worse email than one containing it.
function menuHtml(menu: MenuCourse[], note: string | null): string {
  const fixed = new Set(fixedCourses(menu).map((c) => c.name));
  const courses = menu
    .map((course) => {
      const isFixed = fixed.has(course.name);
      const name = `<div style="font-family:${BODY_FONT};font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${SLATE_SOFT};margin:0 0 8px">${escapeHtml(course.name)}</div>`;
      const dishes = isFixed
        ? `<div style="font-family:${HEAD};font-size:16px;line-height:1.5;color:${SLATE}">${escapeHtml(course.options[0] ?? course.name)}</div>
        <div style="font-family:${BODY_FONT};font-size:12px;color:${SLATE_SOFT};margin-top:6px">Served to everyone.</div>`
        : course.options
            .map(
              (o, i) =>
                (i > 0
                  ? `<div style="font-family:${BODY_FONT};font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:${SLATE_SOFT};margin:10px 0">or</div>`
                  : "") +
                `<div style="font-family:${HEAD};font-size:16px;line-height:1.5;color:${SLATE}">${escapeHtml(o)}</div>`,
            )
            .join("");
      // A bare line ("Coffee and mints") is its own dish; printing the name and then the same
      // name as the dish would read as a stutter.
      const heading = isFixed && course.options.length === 0 ? "" : name;
      return `<tr><td style="padding:16px 22px;border-top:1px solid ${TAN_SOFT};text-align:center">${heading}${dishes}</td></tr>`;
    })
    .join("");

  const key = note
    ? `<tr><td style="padding:14px 22px;border-top:1px solid ${TAN_SOFT};text-align:center;font-family:${BODY_FONT};font-size:11px;line-height:1.6;color:${SLATE_SOFT}">${escapeHtml(note)}</td></tr>`
    : "";

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#FFFDFA;border:1px solid ${TAN_SOFT};border-radius:10px;margin:0 0 20px">
    <tr><td style="padding:16px 22px 4px;text-align:center;font-family:${HEAD};font-size:18px;font-weight:700;color:${MAROON}">The menu</td></tr>
    ${courses}${key}
  </table>`;
}

function menuText(menu: MenuCourse[], note: string | null): string {
  const fixed = new Set(fixedCourses(menu).map((c) => c.name));
  const body = menu
    .map((course) => {
      const isFixed = fixed.has(course.name);
      if (isFixed) {
        const dish = course.options[0] ?? course.name;
        return course.options.length === 0
          ? `${course.name}`
          : `${course.name.toUpperCase()}\n${dish}\n(served to everyone)`;
      }
      return `${course.name.toUpperCase()}\n${course.options.join("\n  or\n")}`;
    })
    .join("\n\n");
  return note ? `${body}\n\n${note}` : body;
}

export function buildMenuReadyEmail(input: MenuReadyInput): MenuReadyEmail {
  const asked = choosableCourses(input.menu);
  // Worded for the common case (there is something to choose) without lying when a venue
  // confirms a menu that happens to be fixed throughout.
  const ask = asked.length > 0
    ? `Tell us what each of your guests would like and we'll pass it to the kitchen. It takes a couple of minutes, and you can save what you know and come back.`
    : `There is nothing to choose, so there is nothing you need to do. We are sending it so you know what is being served.`;

  const body = `<p style="margin:0 0 6px;font-family:${BODY_FONT};font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${SLATE_SOFT};font-weight:700">A night to remember</p>
  <h1 style="color:${CRIMSON};font-family:${HEAD};font-size:26px;font-weight:800;margin:0 0 14px;letter-spacing:-.01em">The menu is here</h1>

  <p ${P}>Hello ${escapeHtml(input.buyerFirstName)}. The Park Hotel have confirmed what they're serving on the night, so here it is.</p>

  ${menuHtml(input.menu, input.menuNote)}

  <p ${P}>${ask}</p>
  ${asked.length > 0
    ? `<div style="text-align:center;margin:22px 0"><a href="${escapeHtml(input.guestLink)}" style="display:inline-block;background:${CRIMSON};color:#F8F5EE;text-decoration:none;font-family:${BODY_FONT};font-weight:700;font-size:15px;padding:12px 26px;border-radius:999px">Choose your courses</a></div>`
    : ""}

  <p ${SMALL}>The same page takes your guests' names and anything they can't eat, so if you have not finished that yet you can do both at once. Booking ${escapeHtml(input.reference)}.</p>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${TAN_SOFT};border-radius:10px;margin:22px 0">
    <tr><td style="padding:16px 20px">
      <div style="font-family:${HEAD};color:${MAROON};font-size:16px;font-weight:700;margin:0 0 6px">Staying over?</div>
      <div style="font-family:${BODY_FONT};color:${SLATE};font-size:14px;line-height:1.6">The Park Hotel are offering ball guests a special rate of <b>£110 per room per night</b>. To book a room, please contact the hotel directly.</div>
    </td></tr>
  </table>

  ${contactPanel("Something you need that isn't on here?")}`;

  const text = `THE MENU IS HERE

Hello ${input.buyerFirstName}. The Park Hotel have confirmed what they're
serving on the night, so here it is.

${menuText(input.menu, input.menuNote)}

${asked.length > 0
    ? `Tell us what each of your guests would like and we'll pass it to the kitchen.
It takes a couple of minutes, and you can save what you know and come back:
${input.guestLink}`
    : `There is nothing to choose, so there is nothing you need to do. We are
sending it so you know what is being served.`}

The same page takes your guests' names and anything they can't eat, so if you
have not finished that yet you can do both at once. Booking ${input.reference}.

STAYING OVER?
The Park Hotel are offering ball guests a special rate of £110 per room per
night. To book a room, please contact the hotel directly.

${BALL_TEXT_FOOTER}`;

  return {
    subject: "The Festive Ball menu is here",
    html: ballEmailShell(body),
    text,
  };
}
