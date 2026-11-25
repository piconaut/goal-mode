// FICTIONAL: the team's own working conditions (PT-50). The team's internal work (TSO in every shipped scenario)
// has a response goal of its own, separate from any customer SLA. The goal is a scenario's content; these are the
// two tunables of the cost it carries.

// FICTIONAL: consecutive clock hours the team's own work may miss its response goal before a slow episode opens.
// Two hours is longer than a single peak and short enough to matter in a played day.
export const INTERNAL_SLOW_WINDOW_HOURS = 2;

// FICTIONAL: what one engineer-hour costs while the team's own work is slow: hands-on changes take half again as
// long while people wait on their screens and help users. IBM gives the TSO goals (WLM Planning PDF p.71
// (printed 51)), not a cost.
export const INTERNAL_SLOW_HOURS_MULT = 1.5;
