import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';

export function useStormRisk() {
    return useQuery({
        queryKey: ['storm-risk'],
        queryFn: async () => {
            const { data } = await api.get('/weather/storm-risk');
            return data.data;
        },
        refetchInterval: 15 * 60 * 1000, // 15 minutes
        staleTime: 10 * 60 * 1000,
        retry: 2,
    });
}

export function useWeatherAlerts() {
    return useQuery({
        queryKey: ['weather-alerts'],
        queryFn: async () => {
            const { data } = await api.get('/weather/alerts');
            return data.data;
        },
        refetchInterval: 15 * 60 * 1000,
        staleTime: 10 * 60 * 1000,
        retry: 2,
    });
}

export function useWeatherForecast() {
    return useQuery({
        queryKey: ['weather-forecast'],
        queryFn: async () => {
            const { data } = await api.get('/weather/forecast');
            return data.data;
        },
        refetchInterval: 60 * 60 * 1000, // 1 hour
        staleTime: 30 * 60 * 1000,
        retry: 2,
    });
}
