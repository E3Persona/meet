## Batch 4: Remaining Delaware + Overflow Venues

This batch is actually better than I expected. Wilmington has several venues that publish proper event feeds, which makes them ideal candidates for Jina.

| Venue                                 | Official Site               | Directory Candidates                                        | Status    |
| ------------------------------------- | --------------------------- | ----------------------------------------------------------- | --------- |
| Chase Center on the Riverfront        | centerontheriverfront.com   | `/events`, `/special-events`, `/contact`, `/fw-event-slug/` | Verified  |
| Riverfront Wilmington (Supplementary) | riverfrontwilm.com          | `/events`, `/events?tribe_redirected=1`                     | Verified  |
| Hotel DuPont                          | hoteldupont.com             | `/events`, `/meetings`, `/dining`                           | High      |
| DoubleTree by Hilton Wilmington       | hilton.com                  | `/events`, `/meetings-events`, `/offers`                    | High      |
| 76ers Fieldhouse (Chase Fieldhouse)   | chasefieldhouse.com         | `/events`, `/schedule`, `/tickets`, `/calendar`             | High      |
| Wilmington Convention Overflow        | visitwilmingtonde.com       | `/events`, `/things-to-do/events`                           | Candidate |
| Delaware Children's Museum*           | delawarechildrensmuseum.org | `/events`, `/calendar`                                      | Candidate |
| Delaware Theatre Company*             | delawaretheatre.org         | `/events`, `/shows`                                         | Candidate |

*These weren't in your original list, but they appear repeatedly as adjacent event sources around the Riverfront and may be useful for future expansion.

The big surprise here is Chase Center.

Their site exposes:

```text
/events
/special-events
/fw-event-slug/
```

And `/fw-event-slug/` is effectively an event feed containing individual entries like:

- Delaware Bridal & Wedding Expo
- Catholic Charities Tribute Dinner
- New Castle County Reads
- Private Events

That means your scraper can probably ingest events directly with almost no LLM assistance. ([centerontheriverfront.com][1])

For Chase Center, I'd seed:

```ts
{
    venue: "Chase Center on the Riverfront",
    verified: true,
    directories: [
        "/events",
        "/fw-event-slug/",
        "/special-events"
    ]
}
```

For 76ers Fieldhouse:

```ts
{
    venue: "76ers Fieldhouse",
    verified: false,
    directories: [
        "/events",
        "/schedule",
        "/tickets"
    ]
}
```

Even though the public branding is inconsistent (Chase Fieldhouse vs. 76ers Fieldhouse), there are numerous public references to events being held there, including the annual Blue x White Scrimmage and Jr. 76ers tournaments. ([Liberty Ballers][2])

### Event Yield Ranking (Batch 4)

```text
1. Chase Center on the Riverfront
2. 76ers Fieldhouse
3. Hotel DuPont
4. DoubleTree Wilmington
```

At this point, you've essentially covered all the major venues from:

- Philadelphia
- Chester
- Washington DC
- Bethesda
- National Harbor
- Atlantic City
- Baltimore
- Wilmington

The remaining work is mostly validation and occasional adjustments for venue-specific quirks.

### Final Recommendation

As you seed these into your existing Next.js project, add one extra field:

```ts
type VenueDirectory = {
    url: string;
    verified: boolean;
    confidence: "verified" | "high" | "candidate";
};
```

That will let you:

```ts
if (directory.confidence === "verified") {
    scrapeImmediately();
}

if (directory.confidence === "candidate") {
    runDiscoveryVerification();
}
```

Chase Center is the standout discovery from this batch because it already exposes an event-oriented structure that's nearly perfect for a Jina → Hash → LLM pipeline. ([centerontheriverfront.com][1])

[1]: https://centerontheriverfront.com/fw-event-slug/?utm_source=chatgpt.com "Events – Chase Center on the Riverfront"
[2]: https://www.libertyballers.com/76ers-news/78719/sixers-announce-blue-x-white-scrimmage-on-october-12?utm_source=chatgpt.com "Sixers announce Blue x White Scrimmage on October 12"
