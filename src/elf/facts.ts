// NBCC Elf Detective School: the 24 facts about NBCC, one for each door. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md (decision 17).
//
// The daily email goes to the grown up, so it is the best place to tell families who have never
// heard of NBCC who we are. The facts tell a four week story: who NBCC is, who we help and where,
// behind the scenes, and how to help. Each has a short, fun line for children that sits on the door.
//
// Jaimie approved every word on 4 October 2026, a week at a time, and confirmed the founding details
// (2015, Tygan aged twelve, 90 boxes, 593 bags). Every number comes from the public About us, home
// and donate pages. Change the wording only with Jaimie's yes.
//
// Two facts were corrected later the same day, each with Jaimie's yes, after an independent check
// against the public pages. Fact 9 had said 4 to 7 year olds were the second biggest group; they
// were third. Fact 22 had said what a monthly gift "is"; it now says what it "could" do, in the
// donate page's own words.
//
// Pure data. Unit tested in test/unit/elf-facts.test.ts, which holds the house style (no dashes, no
// hyphenated words, the building written one way) and a fingerprint of the wording.

export interface ElfFact {
  /** The door this fact belongs to, 1 to 24. */
  door: number;
  /** A short heading. */
  title: string;
  /** The fact as the grown up reads it in the daily email. */
  grownUp: string;
  /** The short line for children, shown on the door once it opens. */
  doorLine: string;
}

export const FACTS: readonly ElfFact[] = [
  // Week 1: who NBCC is.
  {
    door: 1,
    title: "It started with a question",
    grownUp:
      'In 2015 Tygan, aged twelve, from Annbank asked her mum Jodie and her gran: "Do all children get a Christmas Eve box like I do?" The three of them set out to change that, and the Night Before Christmas Campaign was born.',
    doorLine: "NBCC began with a question from a girl aged 12 in Annbank.",
  },
  {
    door: 2,
    title: "90 boxes",
    grownUp: "In their very first year, Tygan, her mum and her gran delivered 90 boxes filled with love and gifts.",
    doorLine: "In its first year, NBCC delivered 90 boxes of Christmas joy.",
  },
  {
    door: 3,
    title: "Doing more",
    grownUp:
      "Seeing people sleeping rough on a cold morning in Glasgow pushed the family to do more, and to register NBCC as a charity.",
    doorLine: "NBCC became a proper charity so it could help even more people.",
  },
  {
    door: 4,
    title: "All volunteers",
    grownUp:
      "Every one of us at NBCC is a volunteer. Your money goes on thoughtful gifts and essential support, not salaries.",
    doorLine: "Every NBCC elf is a volunteer. They help because they love it.",
  },
  {
    door: 5,
    title: "A real Head Elf",
    grownUp:
      "NBCC really does have a Head Elf: Jodie, Tygan's mum, who is also one of the charity's trustees. The volunteers are known as the NBCC elves.",
    doorLine: "NBCC has a real Head Elf. Her name is Jodie!",
  },
  {
    door: 6,
    title: "Growing every year",
    grownUp: "From 593 bags to more than 7,000, the campaign has grown every year, and so has the need.",
    doorLine: "NBCC went from 593 bags to more than 7,000. That's a lot of bags!",
  },
  // Week 2: who NBCC helps, and where.
  {
    door: 7,
    title: "7,657 Red Bags",
    grownUp:
      "In 2025, 7,657 Red Bags Full of Joy went out across South West Scotland. Every one went to a real person who knew they had not been forgotten.",
    doorLine: "Last Christmas, NBCC's elves sent out 7,657 Red Bags Full of Joy!",
  },
  {
    door: 8,
    title: "From babies to grown ups",
    grownUp: "NBCC's Red Bags reach every age. In 2025, 182 went to babies under one, and 528 to adults over 18.",
    doorLine: "Red Bags go to everyone, from tiny babies to grown ups.",
  },
  {
    door: 9,
    title: "The biggest group",
    grownUp:
      "Children aged 8 to 11 were the biggest group NBCC reached in 2025, with 1,990 Red Bags. Another 1,663 went to 4 to 7 year olds.",
    doorLine: "Last year, 1,990 children aged 8 to 11 got a Red Bag.",
  },
  {
    door: 10,
    title: "Teenagers too",
    grownUp:
      "Teenagers are never forgotten. In 2025, 1,719 Red Bags went to 12 to 15 year olds, and 587 to 16 and 17 year olds.",
    doorLine: "Teenagers get Red Bags too!",
  },
  {
    door: 11,
    title: "Girvan to Largs",
    grownUp:
      "NBCC helps children, young people and vulnerable adults across South West Scotland, from Girvan to Largs.",
    doorLine: "NBCC's elves spread joy from Girvan all the way to Largs.",
  },
  {
    door: 12,
    title: "Top communities",
    grownUp:
      "Ayr received the most Red Bags in 2025, 2,096 of them, followed by Kilwinning with 692 and Stevenston with 547.",
    doorLine: "Ayr got the most Red Bags last year: 2,096!",
  },
  {
    door: 13,
    title: "Here all year",
    grownUp:
      "You know us at Christmas. We're here all year. NBCC helps whenever the need comes, with support after a house fire, clothing and school supplies, or a hand at rock bottom.",
    doorLine: "NBCC's elves help all year round, not just at Christmas.",
  },
  // Week 3: behind the scenes.
  {
    door: 14,
    title: "The Elves' Workshop is real",
    grownUp:
      "NBCC's home is the Elves' Workshop at Annbank Village Hall, where volunteers hand over Red Bags Full of Joy by the Christmas tree.",
    doorLine: "The Elves' Workshop is real. It's in Annbank Village Hall!",
  },
  {
    door: 15,
    title: "Made for one person",
    grownUp:
      "Red Bags Full of Joy are NBCC's signature programme: thoughtful, personalised gifts that bring dignity, comfort and moments of joy to people who might otherwise go without at Christmas.",
    doorLine: "Every Red Bag is packed for one special person.",
  },
  {
    door: 16,
    title: "Freddie's dinosaurs",
    grownUp:
      "When NBCC's volunteers heard Freddie loved dinosaurs and monster trucks, they hunted everywhere until his Red Bag was packed full of them. His dad said it gave him a reason to keep going.",
    doorLine: "One boy loved dinosaurs, so the elves filled his bag with them!",
  },
  {
    door: 17,
    title: "Around £50",
    grownUp: "Each Red Bag Full of Joy gives support around the value of £50.",
    doorLine: "Each Red Bag holds about £50 of Christmas joy.",
  },
  {
    door: 18,
    title: "The elves' jobs",
    grownUp:
      "Behind every bag is a team of volunteers with real jobs: a Head Elf, procurement, finance, a project manager and marketing, plus a whole list of volunteer elves.",
    doorLine: "Even elves have jobs, from finding gifts to counting the pennies.",
  },
  {
    door: 19,
    title: "Not forgotten",
    grownUp: "Every pound could help remind someone that they have not been forgotten.",
    doorLine: "Every Red Bag says: you have not been forgotten.",
  },
  {
    door: 20,
    title: "A real person",
    grownUp: "Whether you call or email, you'll reach a real person at NBCC, never a call centre.",
    doorLine: "Phone NBCC and a real elf answers!",
  },
  // Week 4: how you can help.
  {
    door: 21,
    title: "Turn £1 into £1.25",
    grownUp:
      "If you're a UK taxpayer, NBCC can turn every £1 you give into £1.25 on eligible donations, at no cost to you. It's called Gift Aid.",
    doorLine: "Grown ups who pay tax can turn £1 into £1.25 for NBCC!",
  },
  {
    door: 22,
    title: "A little every month",
    grownUp:
      "Monthly gifts help NBCC all year round. £50 a month could help provide support around the value of one Red Bag Full of Joy each month.",
    doorLine: "Some grown ups give a little every month to fill Red Bags.",
  },
  {
    door: 23,
    title: "Raise money your way",
    grownUp:
      "Raise money your way, and we will help. Hold a bake sale, take on a challenge or run an event, and NBCC can send posters, leaflets, collection buckets and the rest.",
    doorLine: "You could hold a bake sale for NBCC!",
  },
  {
    door: 24,
    title: "The Night Before Christmas",
    grownUp:
      "Tonight is the Night Before Christmas. It all began with a Christmas Eve box and a question from a girl aged twelve. Thank you for helping NBCC make sure nobody feels forgotten. You know us at Christmas. We're here all year.",
    doorLine: "It's the Night Before Christmas! Thank you, Detective.",
  },
];

// Approved wording must not be changed by anything that reads it.
for (const fact of FACTS) Object.freeze(fact);
Object.freeze(FACTS);

/** The fact for a door, or null if the number is not a door. */
export function factFor(door: number): ElfFact | null {
  return FACTS.find((f) => f.door === door) ?? null;
}
