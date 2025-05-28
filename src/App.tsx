import { useState, useEffect } from 'react';
import { WindChart } from '@/components/WindChart';
import { WindSummary } from '@/components/WindSummary';
import { TimeRangeSelector } from '@/components/TimeRangeSelector';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { WindDataResponse } from '@/lib/wind-utils';
import { RefreshCw, AlertCircle, TrendingUp } from 'lucide-react';

function App() {
  const [windData, setWindData] = useState<WindDataResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState('7d');
  const [currentHours, setCurrentHours] = useState(168); // 7 days
  const [customRange, setCustomRange] = useState<{ start: Date; end: Date } | null>(null);

  const fetchWindData = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    
    try {
      let params: URLSearchParams;
      
      if (customRange) {
        // For custom ranges, calculate days and use appropriate limit
        const diffTime = customRange.end.getTime() - customRange.start.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const limit = Math.min(4000, Math.max(100, diffDays * 100)); // Adaptive limit
        
        console.log(`Custom range: ${diffDays} days, limit: ${limit}`);
        
        params = new URLSearchParams({
          days: diffDays.toString(),
          limit: limit.toString(),
          ...(forceRefresh && { refresh: 'true' })
        });
      } else {
        // For preset ranges, convert hours to days and set appropriate limit
        const days = Math.max(1, Math.ceil(currentHours / 24));
        const limit = currentHours <= 24 ? '400' : currentHours <= 168 ? '1000' : '4000';
        
        console.log(`Preset range: ${currentHours} hours (${days} days), limit: ${limit}`);
        
        params = new URLSearchParams({
          days: days.toString(),
          limit,
          ...(forceRefresh && { refresh: 'true' })
        });
      }
      
      console.log(`Fetching: /api/wind-data?${params.toString()}`);
      
      const response = await fetch(`/api/wind-data?${params}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data: WindDataResponse = await response.json();
      
      console.log(`Received ${data.data.length} data points`);
      
      // Filter data for hour-based ranges if needed
      if (!customRange && currentHours < 24 * 7) {
        const cutoffTime = new Date(Date.now() - (currentHours * 60 * 60 * 1000));
        const originalLength = data.data.length;
        data.data = data.data.filter(point => new Date(point.datetime) >= cutoffTime);
        console.log(`Filtered from ${originalLength} to ${data.data.length} points for ${currentHours}h range`);
      }
      
      setWindData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch wind data');
      console.error('Error fetching wind data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch data when range changes
  useEffect(() => {
    console.log(`Effect triggered: range=${selectedRange}, hours=${currentHours}, customRange=${customRange ? 'set' : 'null'}`);
    fetchWindData();
  }, [selectedRange, currentHours, customRange]);

  const handleRangeChange = (range: string, hours: number) => {
    console.log(`Range changed: ${range} (${hours} hours)`);
    setSelectedRange(range);
    setCurrentHours(hours);
    setCustomRange(null); // Clear custom range when using presets
  };

  const handleCustomRange = (startDate: Date, endDate: Date) => {
    console.log(`Custom range set: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    setCustomRange({ start: startDate, end: endDate });
    setSelectedRange('custom');
  };

  const handleRefresh = () => {
    console.log('Manual refresh triggered');
    fetchWindData(true);
  };

  const getTimeRangeLabel = () => {
    if (customRange) {
      return `${customRange.start.toLocaleDateString()} - ${customRange.end.toLocaleDateString()}`;
    }
    
    if (currentHours < 24) {
      return `Last ${currentHours} hours`;
    } else {
      const days = Math.ceil(currentHours / 24);
      return `Last ${days} day${days > 1 ? 's' : ''}`;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-8">
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
            Port Olímpic Wind Data
          </h1>
          <p className="text-sm sm:text-base text-gray-600">
            Real-time wind conditions and historical data from Barcelona's Port Olímpic
          </p>
        </div>

        {/* Time Range Selector */}
        <div className="mb-6">
          <TimeRangeSelector
            selectedRange={selectedRange}
            onRangeChange={handleRangeChange}
            onCustomRange={handleCustomRange}
          />
        </div>

        {/* Controls */}
        <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-gray-600" />
            <span className="text-sm font-medium text-gray-700">
              {getTimeRangeLabel()}
            </span>
            {/* Debug info */}
            <span className="text-xs text-gray-500 ml-2">
              ({windData?.data?.length || 0} points)
            </span>
          </div>

          <Button 
            onClick={handleRefresh} 
            disabled={loading}
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh Data
          </Button>
        </div>

        {/* Error State */}
        {error && (
          <Card className="mb-4 sm:mb-6 border-red-200 bg-red-50">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-start gap-2 text-red-700">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <span className="font-medium">Error loading wind data:</span>
                  <span className="ml-1">{error}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Loading State */}
        {loading && (
          <Card className="mb-4 sm:mb-6">
            <CardContent className="p-6 sm:p-8 text-center">
              <RefreshCw className="h-6 sm:h-8 w-6 sm:w-8 animate-spin mx-auto mb-4 text-gray-400" />
              <p className="text-sm sm:text-base text-gray-600">Loading wind data...</p>
            </CardContent>
          </Card>
        )}

        {/* Wind Data Display */}
        {windData && windData.data && windData.data.length > 0 && (
          <div className="space-y-4 sm:space-y-6">
            {/* Summary Cards */}
            <WindSummary 
              data={windData.data} 
              cached={windData.cached}
              timestamp={windData.timestamp}
            />

            {/* Main Chart */}
            <Card className="overflow-hidden">
              <CardHeader className="pb-2 sm:pb-4">
                <CardTitle className="text-base sm:text-lg">
                  Wind Speed and Direction - {getTimeRangeLabel()}
                </CardTitle>
                <div className="text-xs sm:text-sm text-gray-600">
                  {windData.data.length} data points
                  {windData.cached && ' (cached data)'}
                </div>
              </CardHeader>
              <CardContent className="p-2 sm:p-6">
                <WindChart 
                  data={windData.data} 
                  title=""
                  height={currentHours <= 24 ? 350 : 450}
                />
              </CardContent>
            </Card>

            {/* Data Info */}
            <Card>
              <CardContent className="p-3 sm:p-4">
                <div className="text-xs sm:text-sm text-gray-600 space-y-1">
                  <div>Data source: controlmeteo.com</div>
                  <div>Station: Port Olímpic, Barcelona</div>
                  <div>
                    Last updated: {new Date(windData.timestamp).toLocaleString()}
                    {windData.cached && ' (from cache)'}
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    Wind speeds in knots. Use the zoom brush below the chart to focus on specific time periods.
                    Blue line = wind speed, red dashed line = gusts. Arrows show wind direction.
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* No Data State */}
        {windData && (!windData.data || windData.data.length === 0) && !loading && (
          <Card>
            <CardContent className="p-6 sm:p-8 text-center">
              <p className="text-sm sm:text-base text-gray-600">No wind data available for the selected time range.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default App;
