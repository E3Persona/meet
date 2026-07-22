## Batch 3: Atlantic City + Baltimore + Upper Marlboro + Wilmington

This batch is particularly valuable because these venues tend to have public event calendars and convention listings.

| Venue                                     | Official Site             | Directory Candidates                                      | Status    |
| ----------------------------------------- | ------------------------- | --------------------------------------------------------- | --------- |
| Atlantic City Convention Center           | accenter.com              | `/events`, `/home`, `/events/detail/*`, `/calendar`       | Verified  |
| Baltimore Convention Center               | baltimorecc.com           | `/events`, `/calendar`, `/attend`, `/upcoming-events`     | High      |
| Hilton Baltimore Inner Harbor             | hilton.com                | `/events`, `/meetings-events`, `/offers`                  | High      |
| Baltimore Marriott Inner Harbor           | marriott.com              | `/events`, `/meetings-and-events`, `/weddings`            | High      |
| Four Seasons Baltimore                    | fourseasons.com/baltimore | `/experiences`, `/dining`, `/meetings-and-events`         | High      |
| Embassy Suites Baltimore Inner Harbor     | hilton.com                | `/events`, `/meetings-events`, `/offers`                  | High      |
| Hyatt Regency Baltimore Inner Harbor      | hyatt.com                 | `/meetings-and-events`, `/offers`, `/dining`              | High      |
| Baltimore Marriott Waterfront             | marriott.com              | `/events`, `/meetings-and-events`, `/weddings`            | High      |
| Renaissance Baltimore Harborplace         | marriott.com              | `/events`, `/meetings-and-events`, `/offers`              | High      |
| Courtyard Baltimore Downtown/Inner Harbor | marriott.com              | `/events`, `/meetings-and-events`                         | Candidate |
| Hilton Garden Inn Baltimore Inner Harbor  | hilton.com                | `/events`, `/meetings-events`                             | Candidate |
| Hyatt Place Baltimore Inner Harbor        | hyatt.com                 | `/offers`, `/meetings`                                    | Candidate |
| Hotel Indigo Baltimore                    | ihg.com                   | `/meetings-events`, `/offers`                             | Candidate |
| Lord Baltimore Hotel                      | lordbaltimorehotel.com    | `/events`, `/calendar`, `/meetings`, `/weddings`          | High      |
| Hampton Inn Downtown Convention Center    | hilton.com                | `/events`, `/meetings-events`                             | Candidate |
| Rita Rossi Colwell Center                 | ritacolwellcenter.org     | `/events`, `/calendar`, `/venue-rental`                   | High      |
| Murphy Fine Arts Center                   | morgan.edu                | `/events`, `/calendar`, `/performances`                   | High      |
| Chesapeake Arena                          | umbcretrievers.com        | `/calendar`, `/events`, `/tickets`                        | High      |
| Graffiti Warehouse                        | graffitiwarehouse.com     | `/events`, `/calendar`, `/private-events`                 | High      |
| Turf Valley Resort                        | turfvalley.com            | `/events`, `/calendar`, `/golf-events`, `/special-events` | High      |
| Howard County Fairgrounds                 | howardcountyfairmd.com    | `/events`, `/calendar`, `/fair`, `/upcoming-events`       | High      |
| The Show Place Arena                      | showplacearena.com        | `/events`, `/calendar`, `/tickets`                        | High      |
| Chase Center on the Riverfront            | centerontheriverfront.com | `/events`, `/calendar`, `/upcoming-events`, `/news`       | High      |
| Hotel DuPont                              | hoteldupont.com           | `/events`, `/dining`, `/meetings`                         | High      |
| DoubleTree Wilmington                     | hilton.com                | `/events`, `/meetings-events`, `/offers`                  | Candidate |
| 76ers Fieldhouse                          | 76ersfieldhouse.com       | `/events`, `/schedule`, `/tickets`, `/calendar`           | High      |

The most important verified findings:

- Atlantic City Convention Center has an official `/events` page and individual event pages under `/events/detail/*`. ([accenter.com][1])
- The homepage itself contains an embedded event calendar, making `/home` another useful Jina target. ([accenter.com][2])
- Baltimore Convention Center is one of the largest conference venues in the region and consistently hosts major conventions, making `/events` and `/calendar` high-priority targets. ([Visit Baltimore][3])

### Event Yield Ranking

If I had to prioritize scraping in this batch:

```text
1. Atlantic City Convention Center
2. Baltimore Convention Center
3. Howard County Fairgrounds
4. Show Place Arena
5. Chase Center on the Riverfront
6. Turf Valley Resort
7. Murphy Fine Arts Center
8. MGM National Harbor (from Batch 2)
9. 76ers Fieldhouse
10. Graffiti Warehouse
```

### Suggested Seed Objects

```ts
export const batch3 = [
    {
        venue: "Atlantic City Convention Center",
        verified: true,
        directories: [
            "/events",
            "/home",
            "/events/detail/*"
        ]
    },
    {
        venue: "Baltimore Convention Center",
        verified: false,
        directories: [
            "/events",
            "/calendar",
            "/upcoming-events"
        ]
    },
    {
        venue: "Howard County Fairgrounds",
        verified: false,
        directories: [
            "/events",
            "/calendar",
            "/fair"
        ]
    },
    {
        venue: "76ers Fieldhouse",
        verified: false,
        directories: [
            "/events",
            "/schedule",
            "/tickets"
        ]
    }
];
```

One thing you'll notice after Batch 3 is that convention centers are by far the easiest to work with. They almost always expose:

```text
/events
/calendar
/events/detail/*
```

Hotels, on the other hand, rarely publish public event calendars and tend to emphasize meetings, weddings, and venue rentals instead. That's why I expect 70–80% of your publicly discoverable events to come from convention centers, arenas, casinos, fairgrounds, and museums. ([accenter.com][1])

[1]: https://www.accenter.com/events?utm_source=chatgpt.com "Events | Atlantic City Convention Center"
[2]: https://www.accenter.com/?utm_source=chatgpt.com "Atlantic City Convention Center"
[3]: https://baltimore.org/meetings/baltimore-convention-center/?utm_source=chatgpt.com "Baltimore Convention Center | Visit Baltimore"
