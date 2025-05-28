import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { WindDataPoint, formatTime, degToCompass16 } from '@/lib/wind-utils';
import { Wind, Clock, TrendingUp } from 'lucide-react';
import { WindArrow } from './WindArrow';

interface WindSummaryProps {
  data: WindDataPoint[];
  cached?: boolean;
  timestamp?: number;
}

export function WindSummary({ data, cached = false, timestamp }: WindSummaryProps) {
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-gray-500">No wind data available</p>
        </CardContent>
      </Card>
    );
  }

  // Sort data to get the latest reading (most recent timestamp)
  const sortedData = [...data].sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());
  const latest = sortedData[0];
  
  if (!latest) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-gray-500">No wind data available</p>
        </CardContent>
      </Card>
    );
  }
  
  // Calculate statistics
  const windSpeeds = data.map(d => d.wind_speed_knots);
  const maxWindSpeeds = data.map(d => d.max_wind_knots);
  
  const avgWind = windSpeeds.reduce((a, b) => a + b, 0) / windSpeeds.length;
  const maxWind = Math.max(...windSpeeds);
  const maxGust = Math.max(...maxWindSpeeds);
  
  // Determine wind condition color
  const getWindColor = (speed: number) => {
    if (speed >= 20) return 'text-red-600';
    if (speed >= 14) return 'text-orange-600';
    if (speed >= 8) return 'text-yellow-600';
    return 'text-green-600';
  };

  const getWindCondition = (speed: number) => {
    if (speed >= 25) return 'Strong';
    if (speed >= 20) return 'Fresh';
    if (speed >= 14) return 'Moderate';
    if (speed >= 8) return 'Light';
    return 'Calm';
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Combined Current Conditions */}
      <Card className="md:col-span-1">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Wind className="h-4 w-4" />
            Current Conditions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {/* Wind Speed and Direction Row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <WindArrow 
                  direction={latest.wind_direction} 
                  size={28} 
                  className="text-blue-600" 
                />
                <div>
                  <div className="text-sm text-gray-600">{degToCompass16(latest.wind_direction)}</div>
                  <div className="text-xs text-gray-500">{latest.wind_direction.toFixed(0)}°</div>
                </div>
              </div>
              <div className="text-right">
                <div className={`text-2xl font-bold ${getWindColor(latest.wind_speed_knots)}`}>
                  {latest.wind_speed_knots.toFixed(1)}
                </div>
                <div className="text-xs text-gray-600">knots</div>
              </div>
            </div>
            
            {/* Gust Information */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <span className="text-sm text-gray-600">Gust:</span>
              <span className="text-lg font-semibold text-red-600">
                {latest.max_wind_knots.toFixed(1)} kn
              </span>
            </div>
            
            {/* Wind Condition Badge */}
            <div className="flex justify-center pt-1">
              <Badge variant="outline" className="text-xs">
                {getWindCondition(latest.wind_speed_knots)}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Statistics */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Statistics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Average:</span>
              <span className="font-medium">{avgWind.toFixed(1)} kn</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Max Wind:</span>
              <span className="font-medium">{maxWind.toFixed(1)} kn</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Peak Gust:</span>
              <span className="font-medium">{maxGust.toFixed(1)} kn</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-gray-100">
              <span className="text-gray-600">Data Points:</span>
              <span className="font-medium">{data.length}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Last Update */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Last Update
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">
                {formatTime(latest.datetime)}
              </div>
              <div className="text-sm text-gray-600">
                {new Date(latest.datetime).toLocaleDateString()}
              </div>
            </div>
            
            <div className="flex flex-col gap-1 pt-2 border-t border-gray-100">
              {cached && (
                <Badge variant="secondary" className="text-xs self-center">
                  Cached Data
                </Badge>
              )}
              {timestamp && (
                <div className="text-xs text-gray-500 text-center">
                  Refreshed: {new Date(timestamp).toLocaleTimeString()}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 