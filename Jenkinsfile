pipeline {
    agent any
    options {
        skipDefaultCheckout(true)
        timeout(time: 5, unit: 'MINUTES')
        disableConcurrentBuilds()
    }
    stages {
        stage('Webhook smoke test') {
            steps {
                echo 'NovaCart Jenkins pipeline started.'
                echo 'Webhook and SCM integration test only; no deployment is performed.'
            }
        }
    }
}
