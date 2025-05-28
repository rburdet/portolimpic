import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Calendar, Clock } from 'lucide-react';

interface TimeRange {
  label: string;
  hours: number;
  value: string;
}

interface TimeRangeSelectorProps {
  selectedRange: string;
  onRangeChange: (range: string, hours: number) => void;
  onCustomRange?: (startDate: Date, endDate: Date) => void;
}

const TIME_RANGES: TimeRange[] = [
  { label: '6h', hours: 6, value: '6h' },
  { label: '12h', hours: 12, value: '12h' },
  { label: '1d', hours: 24, value: '1d' },
  { label: '3d', hours: 72, value: '3d' },
  { label: '7d', hours: 168, value: '7d' },
  { label: '14d', hours: 336, value: '14d' },
  { label: '30d', hours: 720, value: '30d' },
];

export function TimeRangeSelector({ selectedRange, onRangeChange, onCustomRange }: TimeRangeSelectorProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const handlePresetClick = (range: TimeRange) => {
    console.log(`TimeRangeSelector: Preset clicked - ${range.label} (${range.hours} hours)`);
    onRangeChange(range.value, range.hours);
    setShowCustom(false);
  };

  const handleCustomSubmit = () => {
    if (startDate && endDate && onCustomRange) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (start <= end) {
        console.log(`TimeRangeSelector: Custom range submitted - ${start.toISOString()} to ${end.toISOString()}`);
        onCustomRange(start, end);
        setShowCustom(false);
      } else {
        console.log('TimeRangeSelector: Invalid date range - start date is after end date');
      }
    } else {
      console.log('TimeRangeSelector: Custom range submission failed - missing dates or callback');
    }
  };

  const getCurrentDateTimeLocal = () => {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    const localTime = new Date(now.getTime() - (offset * 60000));
    return localTime.toISOString().slice(0, 16);
  };

  const getDefaultStartDate = () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const offset = yesterday.getTimezoneOffset();
    const localTime = new Date(yesterday.getTime() - (offset * 60000));
    return localTime.toISOString().slice(0, 16);
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="space-y-4">
          {/* Preset Time Ranges */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-gray-600" />
              <span className="text-sm font-medium text-gray-700">Quick Select</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {TIME_RANGES.map((range) => (
                <Button
                  key={range.value}
                  variant={selectedRange === range.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => handlePresetClick(range)}
                  className="text-xs"
                >
                  {range.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Custom Range Toggle */}
          <div className="border-t pt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowCustom(!showCustom)}
              className="text-xs text-gray-600 hover:text-gray-900"
            >
              <Calendar className="h-3 w-3 mr-1" />
              Custom Range
            </Button>
          </div>

          {/* Custom Date Range Picker */}
          {showCustom && (
            <div className="space-y-3 border-t pt-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Start Date & Time
                  </label>
                  <input
                    type="datetime-local"
                    value={startDate || getDefaultStartDate()}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    End Date & Time
                  </label>
                  <input
                    type="datetime-local"
                    value={endDate || getCurrentDateTimeLocal()}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleCustomSubmit}
                  disabled={!startDate || !endDate}
                  className="text-xs"
                >
                  Apply Range
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCustom(false)}
                  className="text-xs"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
} 