export function getWeek(date: Date) {
    var newDate = new Date(date.getTime());
    newDate.setHours(0, 0, 0, 0);
    // Thursday in current week decides the year.
    newDate.setDate(newDate.getDate() + 3 - (newDate.getDay() + 6) % 7);
    // January 4 is always in week 1.
    var week1 = new Date(newDate.getFullYear(), 0, 4);
    // Adjust to Thursday in week 1 and count number of weeks from date to week1.
    return (1 + Math.round(((newDate.getTime() - week1.getTime()) / 86400000
        - 3 + (week1.getDay() + 6) % 7) / 7));
}

export function isToday(date: Date) {
    let now = new Date();
    return Math.floor(date.getTime() / (24 * 60 * 60 * 1000)) === Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
}