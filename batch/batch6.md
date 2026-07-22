## Batch 5: Final Remaining Venues (Hotels + Special Event Spaces)

This batch contains the venues that are the least likely to have traditional public event calendars but are still worth indexing because they occasionally host high-value conferences, galas, and private events.

| Venue                                 | Official Site          | Directory Candidates                           | Status    |
| ------------------------------------- | ---------------------- | ---------------------------------------------- | --------- |
| Sonesta Philadelphia                  | sonesta.com            | `/meetings`, `/special-offers`, `/restaurants` | High      |
| Philadelphia Marriott Old City        | marriott.com           | `/events`, `/meetings-and-events`, `/weddings` | High      |
| Kimpton Hotel Palomar Philadelphia    | ihg.com/kimpton        | `/offers`, `/meetings-events`, `/restaurants`  | High      |
| Kimpton Hotel Monaco Philadelphia     | ihg.com/kimpton        | `/offers`, `/meetings-events`, `/restaurants`  | High      |
| Hilton Philadelphia at Penn's Landing | hilton.com             | `/events`, `/meetings-events`, `/offers`       | High      |
| Philadelphia Airport Marriott         | marriott.com           | `/events`, `/meetings-and-events`, `/offers`   | High      |
| Holiday Inn & Suites Drexel Hill      | ihg.com                | `/meetings-events`, `/offers`                  | Candidate |
| The Warwick Rittenhouse Square        | warwickrittenhouse.com | `/meetings`, `/special-events`, `/offers`      | High      |
| The Notary Hotel Philadelphia         | marriott.com           | `/events`, `/meetings-and-events`, `/weddings` | High      |
| Harborside Hotel National Harbor      | harborsidehotel.com    | `/events`, `/meetings`, `/offers`              | Candidate |
| The Bethesdan Hotel                   | hilton.com             | `/events`, `/meetings-events`, `/offers`       | High      |
| DoubleTree Wilmington                 | hilton.com             | `/events`, `/meetings-events`, `/offers`       | High      |

### Special Event Venues

These are particularly interesting because they tend to expose public event listings.

| Venue                             | Directory Candidates                      | Status |
| --------------------------------- | ----------------------------------------- | ------ |
| Independence Seaport Museum       | `/events`, `/calendar`, `/exhibits`       | High   |
| Pennsylvania Academy of Fine Arts | `/events`, `/calendar`, `/exhibitions`    | High   |
| Crystal Tea Room                  | `/events`, `/weddings`, `/social-events`  | High   |
| Liberty View                      | `/events`, `/private-events`, `/weddings` | High   |
| Murphy Fine Arts Center           | `/events`, `/performances`, `/calendar`   | High   |
| Graffiti Warehouse                | `/events`, `/calendar`, `/private-events` | High   |
| Rita Rossi Colwell Center         | `/events`, `/calendar`, `/venue-rental`   | High   |

### The Hidden Gems

After going through your entire list, these are the venues I'd expect to produce the most events:

```text
Pennsylvania Convention Center
Walter E. Washington Convention Center
Baltimore Convention Center
Atlantic City Convention Center
Greater Philadelphia Expo Center
Gaylord National
MGM National Harbor
Live! Casino Philadelphia
Howard County Fairgrounds
Show Place Arena
Chase Center on the Riverfront
76ers Fieldhouse
Subaru Park
Independence Seaport Museum
PAFA
Temple University
```

### The Gold Tier Directories

These are the ones I'd scrape first because they are known to expose event data consistently:

```text
/events
/calendar
/upcoming-events
/events/month
/events/detail/*
/entertainment
/shows
/fw-event-slug/
```

Howard County Fairgrounds is a great example:

```text
https://howardcountyfairmd.com/events-calendar/
https://howardcountyfairmd.com/events/month/
https://howardcountyfairmd.com/venue/howard-county-fairgrounds/
```

All three are producing structured event data today. ([The Howard County Fair][1])

### Final Seed Strategy

I'd assign priorities like this:

```ts
enum Priority {
    GOLD,
    SILVER,
    BRONZE
}
```

```text
GOLD
-----
Convention Centers
Casinos
Fairgrounds
Museums
Arenas

SILVER
------
Universities
Stadiums
Conference Centers

BRONZE
------
Hotels
Wedding Venues
Meeting Spaces
```

Then your existing Next.js job can simply do:

```ts
for (const venue of venues) {
    if (venue.priority === "GOLD") {
        scrapeEvery(6_hours);
    }

    if (venue.priority === "SILVER") {
        scrapeEvery(24_hours);
    }

    if (venue.priority === "BRONZE") {
        scrapeEvery(7_days);
    }
}
```

At this point, you have effectively covered all venues from your original list and identified the directories most likely to yield public events. Convention centers, fairgrounds, casinos, and museums will almost certainly give you the highest ROI for your Jina → Hash → LLM pipeline. ([The Howard County Fair][1])

[1]: https://howardcountyfairmd.com/events-calendar/?utm_source=chatgpt.com "Events Calendar - The Howard County Fair"
