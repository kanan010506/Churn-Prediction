import json
import sys
from pathlib import Path

import joblib
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = ROOT / 'ml' / 'model' / 'churn_model.joblib'


def bool_to_yes_no(value):
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {'yes', 'y', 'true', '1'}:
            return 'Yes'
        return 'No'
    return 'Yes' if bool(value) else 'No'


def build_input_row(payload, monthly_median):
    tenure          = int(payload.get('tenure', 12) or 0)
    monthly         = float(payload.get('monthlyCharges', 65) or 0)
    # Note: totalCharges not sent from frontend — approximated as monthly * tenure.
    # This underestimates for long-tenure customers whose charges changed over time.
    total_charges   = float(payload.get('totalCharges', monthly * tenure) or (monthly * tenure))

    internet_service    = payload.get('internetService', 'Fiber optic').strip()
    online_security     = bool_to_yes_no(payload.get('onlineSecurity', 'No'))
    online_backup       = bool_to_yes_no(payload.get('onlineBackup', 'No'))
    device_protection   = bool_to_yes_no(payload.get('deviceProtection', 'No'))
    tech_support        = bool_to_yes_no(payload.get('techSupport', 'No'))
    streaming_tv        = bool_to_yes_no(payload.get('streamingTV', 'No'))
    streaming_movies    = bool_to_yes_no(payload.get('streamingMovies', 'No'))

    if internet_service == 'No':
        online_security  = online_backup = device_protection = \
        tech_support     = streaming_tv  = streaming_movies  = 'No internet service'

    phone_service   = payload.get('phoneService', 'Yes')
    multiple_lines  = payload.get('multipleLines', 'No')
    if phone_service == 'No':
        multiple_lines = 'No phone service'

    row = {
        'gender':           payload.get('gender', 'Male'),
        'SeniorCitizen':    int(payload.get('seniorCitizen', 0) or 0),
        'Partner':          payload.get('partner', 'No'),
        'Dependents':       payload.get('dependents', 'No'),
        'tenure':           tenure,
        'PhoneService':     phone_service,
        'MultipleLines':    multiple_lines,
        'InternetService':  internet_service,
        'OnlineSecurity':   online_security,
        'OnlineBackup':     online_backup,
        'DeviceProtection': device_protection,
        'TechSupport':      tech_support,
        'StreamingTV':      streaming_tv,
        'StreamingMovies':  streaming_movies,
        'Contract':         payload.get('contract', 'Month-to-month'),
        'PaperlessBilling': payload.get('paperlessBilling', 'Yes'),
        'PaymentMethod':    payload.get('paymentMethod', 'Electronic check'),
        'MonthlyCharges':   monthly,
        'TotalCharges':     total_charges,
    }

    service_cols = [
        'PhoneService', 'MultipleLines', 'OnlineSecurity', 'OnlineBackup',
        'DeviceProtection', 'TechSupport', 'StreamingTV', 'StreamingMovies',
    ]

    row['ChargesPerTenure']     = row['TotalCharges'] / (row['tenure'] + 1)
    row['IsNewCustomer']        = int(row['tenure'] <= 6)
    row['IsLongTermCustomer']   = int(row['tenure'] >= 24)
    row['NumServices']          = sum(1 for col in service_cols if row[col] == 'Yes')
    row['HasInternet']          = int(row['InternetService'] != 'No')

    row['EasyLeaver'] = int(
        row['PaperlessBilling'] == 'Yes' and
        row['PaymentMethod']    == 'Electronic check'
    )
    row['FiberNoAddons'] = int(
        row['InternetService']  == 'Fiber optic' and
        row['OnlineSecurity']   == 'No' and
        row['OnlineBackup']     == 'No' and
        row['DeviceProtection'] == 'No'
    )
    row['SoloCustomer'] = int(
        row['Partner']    == 'No' and
        row['Dependents'] == 'No'
    )
    row['NoProtection'] = int(
        row['OnlineSecurity'] == 'No' and
        row['OnlineBackup']   == 'No' and
        row['TechSupport']    == 'No'
    )
    row['HighRiskCombo'] = int(
        row['Contract']        == 'Month-to-month' and
        row['MonthlyCharges']  >  monthly_median
    )

    return row


def build_risk_factors(row, importance_map):
    """
    Risk factors come 100% from the model's feature_importances_.
    importance_map is saved into the artifact during training — no hardcoding.
    We only surface features that are actually active (non-zero / triggered)
    for this specific customer.
    """

    # Features that are binary flags — only show if the flag is ON (== 1)
    binary_flags = {
        'EasyLeaver', 'FiberNoAddons', 'NoProtection',
        'HighRiskCombo', 'IsNewCustomer', 'SoloCustomer',
        'IsLongTermCustomer', 'HasInternet',
    }

    # Features always relevant (numeric — always include)
    always_include = {'tenure', 'MonthlyCharges', 'TotalCharges', 'ChargesPerTenure', 'NumServices'}

    # Contract is categorical — map to a readable label
    contract_label = {
        'Month-to-month': 'Contract (M2M)',
        'One year':        'Contract (1yr)',
        'Two year':        'Contract (2yr)',
    }

    active_features = {}

    for feature, importance in importance_map.items():
        if feature in binary_flags:
            # Only include if this flag is triggered for this customer
            if row.get(feature, 0) == 1:
                active_features[feature] = importance
        elif feature in always_include:
            active_features[feature] = importance
        elif feature == 'Contract':
            label = contract_label.get(row.get('Contract', ''), 'Contract')
            active_features[label] = importance
        elif feature == 'InternetService':
            active_features[f"Internet ({row.get('InternetService', '?')})"] = importance

    # Sort by model importance, take top 4
    top4 = sorted(active_features.items(), key=lambda x: x[1], reverse=True)[:4]

    # importance_map values are already 0–100 normalised from training
    return [{'name': name, 'val': round(val)} for name, val in top4]


def main() -> None:
    raw_input = sys.stdin.read().strip()
    payload   = json.loads(raw_input) if raw_input else {}

    if not MODEL_PATH.exists():
        raise FileNotFoundError('Model file not found. Run ml/train_model.py first.')

    artifact        = joblib.load(MODEL_PATH)
    model           = artifact['model']
    preprocessor    = artifact['preprocessor']
    monthly_median  = float(artifact['monthly_median'])
    columns         = artifact['columns']
    importance_map  = artifact['importance_map']   # ← from real model, no hardcoding

    row = build_input_row(payload, monthly_median)

    x   = pd.DataFrame([[row[col] for col in columns]], columns=columns)
    x_t = preprocessor.transform(x)

    prob     = float(model.predict_proba(x_t)[0, 1])
    score    = round(prob * 100)
    is_churn = prob >= 0.5

    if prob >= 0.60:
        risk_label = 'HIGH RISK'
        risk_sub   = 'Immediate retention action needed'
    elif prob >= 0.40:
        risk_label = 'MEDIUM RISK'
        risk_sub   = 'Monitor closely - proactive outreach'
    else:
        risk_label = 'LOW RISK'
        risk_sub   = 'Customer likely to stay'

    result = {
        'score':        score,
        'probability':  prob,
        'isChurn':      is_churn,
        'riskLabel':    risk_label,
        'riskSub':      risk_sub,
        'riskFactors':  build_risk_factors(row, importance_map),
    }

    print(json.dumps(result))


if __name__ == '__main__':
    main()