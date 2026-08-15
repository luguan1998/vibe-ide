/** Time constants plus parsing and formatting helpers. */
export var Time;
(function (Time) {
    Time.millisecond = 1;
    Time.second = 1000;
    Time.minute = Time.second * 60;
    Time.hour = Time.minute * 60;
    Time.day = Time.hour * 24;
    Time.week = Time.day * 7;
    let timezoneOffset = new Date().getTimezoneOffset();
    function setTimezoneOffset(offset) {
        timezoneOffset = offset;
    }
    Time.setTimezoneOffset = setTimezoneOffset;
    function getTimezoneOffset() {
        return timezoneOffset;
    }
    Time.getTimezoneOffset = getTimezoneOffset;
    function getDateNumber(date = new Date(), offset) {
        if (typeof date === 'number')
            date = new Date(date);
        if (offset === undefined)
            offset = timezoneOffset;
        return Math.floor((date.valueOf() / Time.minute - offset) / 1440);
    }
    Time.getDateNumber = getDateNumber;
    function fromDateNumber(value, offset) {
        const date = new Date(value * Time.day);
        if (offset === undefined)
            offset = timezoneOffset;
        return new Date(+date + offset * Time.minute);
    }
    Time.fromDateNumber = fromDateNumber;
    const numeric = /\d+(?:\.\d+)?/.source;
    const timeRegExp = new RegExp(`^${[
        'w(?:eek(?:s)?)?',
        'd(?:ay(?:s)?)?',
        'h(?:our(?:s)?)?',
        'm(?:in(?:ute)?(?:s)?)?',
        's(?:ec(?:ond)?(?:s)?)?',
    ].map(unit => `(${numeric}${unit})?`).join('')}$`);
    function parseTime(source) {
        const capture = timeRegExp.exec(source);
        if (!capture)
            return 0;
        return (parseFloat(capture[1]) * Time.week || 0)
            + (parseFloat(capture[2]) * Time.day || 0)
            + (parseFloat(capture[3]) * Time.hour || 0)
            + (parseFloat(capture[4]) * Time.minute || 0)
            + (parseFloat(capture[5]) * Time.second || 0);
    }
    Time.parseTime = parseTime;
    function parseDate(date) {
        const parsed = parseTime(date);
        if (parsed) {
            date = Date.now() + parsed;
        }
        else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) {
            date = `${new Date().toLocaleDateString()}-${date}`;
        }
        else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) {
            date = `${new Date().getFullYear()}-${date}`;
        }
        return date ? new Date(date) : new Date();
    }
    Time.parseDate = parseDate;
    function format(ms) {
        const abs = Math.abs(ms);
        if (abs >= Time.day - Time.hour / 2) {
            return Math.round(ms / Time.day) + 'd';
        }
        else if (abs >= Time.hour - Time.minute / 2) {
            return Math.round(ms / Time.hour) + 'h';
        }
        else if (abs >= Time.minute - Time.second / 2) {
            return Math.round(ms / Time.minute) + 'm';
        }
        else if (abs >= Time.second) {
            return Math.round(ms / Time.second) + 's';
        }
        return ms + 'ms';
    }
    Time.format = format;
    function toDigits(source, length = 2) {
        return source.toString().padStart(length, '0');
    }
    Time.toDigits = toDigits;
    function template(template, time = new Date()) {
        return template
            .replace('yyyy', time.getFullYear().toString())
            .replace('yy', time.getFullYear().toString().slice(2))
            .replace('MM', toDigits(time.getMonth() + 1))
            .replace('dd', toDigits(time.getDate()))
            .replace('hh', toDigits(time.getHours()))
            .replace('mm', toDigits(time.getMinutes()))
            .replace('ss', toDigits(time.getSeconds()))
            .replace('SSS', toDigits(time.getMilliseconds(), 3));
    }
    Time.template = template;
})(Time || (Time = {}));
//# sourceMappingURL=time.js.map